/**
 * Thin translation layer between Shopify's Function input/output and the pure
 * @zj/discount-core types. All discount maths lives in core; this file only maps
 * shapes (Decimal strings ⇄ integer minor units, GraphQL lines ⇄ core lines).
 */
import {
  currencyExponent,
  formatMinor,
  parseDecimalToMinor,
  type Cart,
  type CartLine,
  type RuleMetafieldPayload,
  type RuleResult,
} from "@zj/discount-core";

/** Minimal structural view of the cart-lines input (matches the generated CartInput). */
export interface LinesInputLike {
  presentmentCurrencyRate: string | number;
  cart: {
    lines: ReadonlyArray<{
      id: string;
      quantity: number;
      cost: { subtotalAmount: { amount: string | number; currencyCode: string } };
      merchandise:
        | { __typename: "ProductVariant"; id: string; product: { id: string; inAnyCollection: boolean } }
        | { __typename: string };
    }>;
  };
}

export function toCoreCart(input: LinesInputLike, payload: RuleMetafieldPayload): Cart {
  const lines = input.cart.lines;
  const currencyCode = lines.length > 0 ? lines[0].cost.subtotalAmount.currencyCode : "USD";
  const exp = currencyExponent(currencyCode);
  const out: CartLine[] = [];
  for (const line of lines) {
    const m = line.merchandise;
    const isVariant = m.__typename === "ProductVariant" && "product" in m;
    let subtotalMinor: number;
    try {
      subtotalMinor = parseDecimalToMinor(line.cost.subtotalAmount.amount, exp);
    } catch {
      continue; // unparseable amount: skip the line rather than fail the whole checkout
    }
    out.push({
      id: line.id,
      quantity: line.quantity,
      subtotalMinor,
      productId: isVariant ? m.product.id : "",
      variantId: isVariant ? m.id : null,
      // inAnyCollection only says yes/no; "yes" means in at least one of the rule's collections.
      collectionIds: isVariant && m.product.inAnyCollection ? payload.collectionIds : [],
    });
  }
  return { currencyCode, lines: out };
}

/** Product-class operations: one fixed-amount candidate per discounted line, exact to the minor unit. */
export function toProductOperations(result: RuleResult) {
  if (result.lines.length === 0) return [];
  const exp = currencyExponent(result.currencyCode);
  return [
    {
      productDiscountsAdd: {
        candidates: result.lines.map((l) => ({
          message: result.message,
          targets: [{ cartLine: { id: l.lineId } }],
          value: { fixedAmount: { amount: formatMinor(l.amountMinor, exp) } },
        })),
        selectionStrategy: "ALL" as const,
      },
    },
  ];
}
