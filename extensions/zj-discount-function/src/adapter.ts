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
  type ProductTarget,
  type RuleResult,
} from "@zj/discount-core";

/** Structural view of the cart-lines input (matches the generated CartInput). */
export interface LinesInputLike {
  presentmentCurrencyRate: string | number;
  cart: {
    cost: { subtotalAmount: { amount: string | number; currencyCode: string } };
    lines: ReadonlyArray<{
      id: string;
      quantity: number;
      cost: { amountPerQuantity: { amount: string | number } };
      merchandise: { product?: { id: string; inAnyCollection: boolean } };
    }>;
  };
}

/**
 * Lines in the rule's product set, as core lines. Lines outside the set can never be
 * discounted (and don't count towards buy X get Y sets), so they are dropped before the
 * comparatively costly amount parsing; core filters by the same target, so the result
 * is identical. Collection targets use the input query's `inAnyCollection` yes/no;
 * product targets compare the line's product id.
 */
export function toCoreCart(input: LinesInputLike, target: ProductTarget, collectionIds: readonly string[]): Cart {
  const currencyCode = input.cart.cost.subtotalAmount.currencyCode;
  const exp = currencyExponent(currencyCode);
  const src = input.cart.lines;
  const productIds = target.kind === "PRODUCTS" ? target.productIds : null;
  const lines: CartLine[] = [];
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const product = line.merchandise.product;
    if (product === undefined) continue;
    if (productIds !== null ? !productIds.includes(product.id) : !product.inAnyCollection) continue;
    let unitPriceMinor: number;
    try {
      unitPriceMinor = decimalToMinor(line.cost.amountPerQuantity.amount, exp);
    } catch {
      continue; // unparseable amount: skip the line rather than fail the checkout
    }
    lines.push({
      id: line.id,
      quantity: line.quantity,
      unitPriceMinor,
      subtotalMinor: unitPriceMinor * line.quantity,
      productId: product.id,
      // "in any of the rule's collections" → the rule's collection ids (core re-checks)
      collectionIds,
    });
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
      // quantity: discount only that many units of the line (buy X get Y); absent = whole line.
      targets: [l.quantity === undefined ? { cartLine: { id: l.lineId } } : { cartLine: { id: l.lineId, quantity: l.quantity } }],
      value: { fixedAmount: { amount: minorToNumber(l.amountMinor, exp) } },
    };
  }
  return [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" as const } }];
}

/** Order rules only need the subtotal Shopify reports; line data is ignored. */
export function toCoreOrderCart(input: LinesInputLike): Cart {
  const { amount, currencyCode } = input.cart.cost.subtotalAmount;
  let subtotalMinor = 0;
  try {
    subtotalMinor = decimalToMinor(amount, currencyExponent(currencyCode));
  } catch {
    subtotalMinor = 0;
  }
  return { currencyCode, lines: [], subtotalMinor };
}

/**
 * Order-class operation on the order subtotal. Percentage tiers are sent as a
 * percentage, so Shopify applies them to the subtotal it discounts (after any product
 * discounts this combines with); fixed tiers are sent as the exact converted, clamped
 * amount. No message: Shopify shows the discount's title.
 */
export function toOrderOperations(result: RuleResult) {
  const order = result.order;
  if (order === null) return [];
  const value =
    order.percent !== null
      ? { percentage: { value: order.percent } }
      : { fixedAmount: { amount: minorToNumber(order.amountMinor, currencyExponent(result.currencyCode)) } };
  return [
    {
      orderDiscountsAdd: {
        candidates: [{ targets: [{ orderSubtotal: { excludedCartLineIds: [] } }], value }],
        selectionStrategy: "FIRST" as const,
      },
    },
  ];
}
