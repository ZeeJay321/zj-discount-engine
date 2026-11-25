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
  type BundleComponent,
  type DeliveryGroup,
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
      merchandise: { id?: string; product?: { id: string; inAnyCollection: boolean } };
    }>;
  };
}

/**
 * The rule's lines, as core lines. Lines the rule can't use can never be discounted
 * (and don't count towards buy X get Y sets or bundles), so they are dropped before the
 * comparatively costly amount parsing; core matches by the same rule, so the result is
 * identical. `keep` decides: collection targets use the query's `inAnyCollection`,
 * product targets the product id, bundles the variant or product id.
 */
/** Line filter: keep a line (variant id, product id, inAnyCollection) for this rule? */
export type LineFilter = (variantId: string, productId: string, inAnyCollection: boolean) => boolean;

/** Amount-off / buy X get Y: in the rule's product set (collections or product list). */
export function targetFilter(target: ProductTarget): LineFilter {
  if (target.kind === "PRODUCTS") {
    const ids = target.productIds;
    return (_v, productId) => ids.includes(productId);
  }
  return (_v, _p, inAnyCollection) => inAnyCollection;
}

/** Bundles: the line is one of the components (a whole product or that exact variant). */
export function bundleFilter(components: readonly BundleComponent[]): LineFilter {
  const variants: string[] = [];
  const products: string[] = [];
  for (const c of components) (c.kind === "VARIANT" ? variants : products).push(c.kind === "VARIANT" ? c.variantId : c.productId);
  return (variantId, productId) => variants.includes(variantId) || products.includes(productId);
}

export function toCoreCart(input: LinesInputLike, keep: LineFilter, collectionIds: readonly string[]): Cart {
  const currencyCode = input.cart.cost.subtotalAmount.currencyCode;
  const exp = currencyExponent(currencyCode);
  const src = input.cart.lines;
  const lines: CartLine[] = [];
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const m = line.merchandise;
    const product = m.product;
    if (product === undefined) continue;
    const variantId = m.id ?? "";
    if (!keep(variantId, product.id, product.inAnyCollection)) continue;
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
      variantId,
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
      // quantity: discount only that many units of the line (buy X get Y, bundles); absent = whole line.
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

/** Structural view of the delivery-options input. */
export interface DeliveryInputLike {
  presentmentCurrencyRate: string | number;
  cart: {
    cost: { subtotalAmount: { amount: string | number; currencyCode: string } };
    deliveryGroups: ReadonlyArray<{
      deliveryOptions: ReadonlyArray<{
        handle: string;
        cost: { amount: string | number };
      }>;
    }>;
  };
}

/** Shipping rules: cart subtotal + delivery option handles and costs. No lines. */
export function toCoreDeliveryCart(input: DeliveryInputLike): Cart {
  const { amount, currencyCode } = input.cart.cost.subtotalAmount;
  const exp = currencyExponent(currencyCode);
  let subtotalMinor = 0;
  try {
    subtotalMinor = decimalToMinor(amount, exp);
  } catch {
    subtotalMinor = 0;
  }
  const deliveryGroups: DeliveryGroup[] = [];
  const src = input.cart.deliveryGroups ?? [];
  for (let g = 0; g < src.length; g++) {
    const options = [];
    const opts = src[g].deliveryOptions ?? [];
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      let costMinor = 0;
      try {
        costMinor = decimalToMinor(o.cost.amount, exp);
      } catch {
        continue;
      }
      options.push({ handle: o.handle, costMinor });
    }
    deliveryGroups.push({ options });
  }
  return { currencyCode, lines: [], subtotalMinor, deliveryGroups };
}

/**
 * Shipping-class operations: one candidate per discounted delivery option. Percentage
 * when the max did not clamp; otherwise the exact fixed amount. selectionStrategy is
 * always ALL (the only strategy Shopify exposes for delivery discounts).
 */
export function toDeliveryOperations(result: RuleResult) {
  const n = result.shipping.length;
  if (n === 0) return [];
  const exp = currencyExponent(result.currencyCode);
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = result.shipping[i];
    const value =
      s.percent !== null
        ? { percentage: { value: s.percent } }
        : { fixedAmount: { amount: minorToNumber(s.amountMinor, exp) } };
    candidates[i] = {
      targets: [{ deliveryOption: { handle: s.handle } }],
      value,
    };
  }
  return [{ deliveryDiscountsAdd: { candidates, selectionStrategy: "ALL" as const } }];
}
