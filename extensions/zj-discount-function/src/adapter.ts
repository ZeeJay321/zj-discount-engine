/**
 * Thin translation layer between Shopify's Function input/output and the pure
 * @zj/discount-core types. All discount maths lives in core; this file only maps
 * shapes (Decimal strings ⇄ integer minor units, GraphQL lines ⇄ core lines).
 * Kept allocation-light: it runs once per cart line inside the instruction budget.
 */
import {
  currencyExponent,
  decimalToMinor,
  minorToNumber,
  type Cart,
  type CartLine,
  type RuleResult,
} from "@zj/discount-core";

/** Structural view of the cart-lines input (matches the generated CartInput). */
export interface LinesInputLike {
  presentmentCurrencyRate: string | number;
  cart: {
    cost: { subtotalAmount: { currencyCode: string } };
    lines: ReadonlyArray<{
      id: string;
      quantity: number;
      cost: { subtotalAmount: { amount: string | number } };
      merchandise: { product?: { inAnyCollection: boolean } };
    }>;
  };
}

export function toCoreCart(input: LinesInputLike, collectionIds: readonly string[]): Cart {
  const currencyCode = input.cart.cost.subtotalAmount.currencyCode;
  const exp = currencyExponent(currencyCode);
  const src = input.cart.lines;
  const lines: CartLine[] = [];
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    // inAnyCollection is yes/no; "yes" means in at least one of the rule's collections.
    // Lines outside the collections can never be discounted by this rule type, so they
    // are dropped before the (comparatively costly) amount parsing. Core would filter
    // them out anyway, so the result is identical.
    const product = line.merchandise.product;
    if (product === undefined || !product.inAnyCollection) continue;
    let subtotalMinor: number;
    try {
      subtotalMinor = decimalToMinor(line.cost.subtotalAmount.amount, exp);
    } catch {
      continue; // unparseable amount: skip the line rather than fail the checkout
    }
    lines.push({ id: line.id, quantity: line.quantity, subtotalMinor, collectionIds });
  }
  return { currencyCode, lines };
}

/**
 * Product-class operations: one fixed-amount candidate per discounted line, exact to
 * the minor unit. Amounts are JSON numbers (cheaper than building Decimal strings). No per-candidate message, so Shopify shows the discount's title
 * (which the app sets to the rule title).
 */
export function toProductOperations(result: RuleResult) {
  const n = result.lines.length;
  if (n === 0) return [];
  const exp = currencyExponent(result.currencyCode);
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = result.lines[i];
    candidates[i] = {
      targets: [{ cartLine: { id: l.lineId } }],
      value: { fixedAmount: { amount: minorToNumber(l.amountMinor, exp) } },
    };
  }
  return [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" as const } }];
}
