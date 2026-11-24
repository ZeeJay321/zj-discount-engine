/**
 * Core types. Everything here is plain data: no Shopify SDK types, no I/O.
 * Money is always an integer count of minor units (cents, yen, fils…).
 */

export type DiscountClass = "PRODUCT" | "ORDER" | "SHIPPING";

export interface CartLine {
  id: string;
  quantity: number;
  /** Line subtotal (unit price × quantity) in the cart's currency, minor units. */
  subtotalMinor: number;
  productId?: string;
  variantId?: string | null;
  /**
   * Collections this line's product belongs to, out of the ones the rule asks about.
   * The Function only learns "in any of the rule's collections: yes/no"; the adapter
   * turns `true` into the rule's collection IDs and `false` into [].
   */
  collectionIds: readonly string[];
}

export interface Cart {
  /** ISO 4217 code of the cart (presentment) currency. */
  currencyCode: string;
  lines: readonly CartLine[];
}

export type AmountOffValue =
  | {
      kind: "PERCENTAGE";
      /** 0 < percent <= 100, at most 2 decimal places. */
      percent: number;
    }
  | {
      kind: "FIXED_AMOUNT";
      /** Amount in the shop's base currency, minor units. */
      amountMinor: number;
      /** Shop base currency (ISO 4217). */
      currencyCode: string;
      /** true: amount off every eligible item; false: amount off once, split across eligible lines. */
      appliesToEachItem: boolean;
    };

export type ProductTarget = {
  kind: "COLLECTIONS";
  collectionIds: string[];
};

export interface AmountOffProductsConfig {
  type: "AMOUNT_OFF_PRODUCTS";
  target: ProductTarget;
  value: AmountOffValue;
}

/** Discriminated union; later rule types (tiered, BOGO, bundle, free shipping) join here. */
export type RuleConfig = AmountOffProductsConfig;
export type RuleType = RuleConfig["type"];

export interface CombinesWith {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
}

/** What the admin edits and the DB stores (minus sync bookkeeping). */
export interface RuleDraft {
  id?: string;
  title: string;
  enabled: boolean;
  priority: number;
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601, or null for no end date */
  endsAt: string | null;
  combinesWith: CombinesWith;
  config: RuleConfig;
}

/** The subset of a rule the evaluator needs. This is exactly what the Function sees. */
export interface EvaluableRule {
  ruleId: string;
  title: string;
  config: RuleConfig;
}

export interface EvaluateContext {
  /**
   * Shop currency → cart currency rate, as Shopify's `presentmentCurrencyRate`.
   * 1 when the cart is in the shop currency.
   */
  presentmentCurrencyRate: number | string;
}

export interface LineDiscount {
  lineId: string;
  /** Discount for the whole line, in cart currency minor units. Always > 0. */
  amountMinor: number;
}

export interface RuleResult {
  ruleId: string;
  discountClass: DiscountClass;
  message: string;
  currencyCode: string;
  lines: LineDiscount[];
  totalMinor: number;
}
