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
  /**
   * Price of one unit, minor units (Shopify's `cost.amountPerQuantity`). When absent
   * it is derived as subtotalMinor / quantity (rounded).
   */
  unitPriceMinor?: number;
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
  /**
   * Cart subtotal in minor units, when known without lines (the Function's tiered path
   * reads only `cart.cost.subtotalAmount`). Otherwise order rules sum the line subtotals.
   */
  subtotalMinor?: number;
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

/** Which products a product-class rule applies to: whole collections, or a product list. */
export type ProductTarget =
  | { kind: "COLLECTIONS"; collectionIds: string[] }
  | { kind: "PRODUCTS"; productIds: string[] };

export interface AmountOffProductsConfig {
  type: "AMOUNT_OFF_PRODUCTS";
  target: ProductTarget;
  value: AmountOffValue;
}

export type TierValue =
  | { kind: "PERCENTAGE"; percent: number }
  | { kind: "FIXED_AMOUNT"; amountMinor: number };

export interface SpendTier {
  /** Spend threshold in the shop currency, minor units. Reached when subtotal >= threshold. */
  thresholdMinor: number;
  value: TierValue;
}

/** Spend X get Y off the order: the highest tier reached applies, to the whole cart subtotal. */
export interface TieredSpendConfig {
  type: "TIERED_SPEND";
  /** Shop base currency (ISO 4217) for thresholds and fixed amounts. */
  currencyCode: string;
  /** 2–5 tiers, strictly increasing thresholds, all the same value kind. */
  tiers: SpendTier[];
}

/**
 * Buy X get Y from the same product set. Each "set" is X + Y eligible units; the
 * cheapest units are discounted (ties: earlier cart line first), Y per set, at most
 * `limitPerOrder` sets.
 */
export interface BuyXGetYConfig {
  type: "BUY_X_GET_Y";
  target: ProductTarget;
  /** X: units that must be bought per set (1–100). */
  buyQuantity: number;
  /** Y: units discounted per set (1–100). */
  getQuantity: number;
  /** Discount on the Y units: 0 < percent <= 100 (100 = free), at most 2 decimals. */
  percent: number;
  /** Maximum number of sets per order (1–100). */
  limitPerOrder: number;
}

/** One bundle component: a whole product (any variant) or one specific variant, × quantity. */
export type BundleComponent =
  | { kind: "PRODUCT"; productId: string; quantity: number }
  | {
      kind: "VARIANT";
      variantId: string;
      /** The variant's product (used to reject a variant whose product is also a component). */
      productId: string;
      quantity: number;
    };

export type BundleValue =
  | { kind: "PERCENTAGE"; percent: number }
  /** Amount off each complete bundle, shop currency minor units. */
  | { kind: "FIXED_AMOUNT"; amountMinor: number }
  /** The price a complete bundle costs, shop currency minor units. */
  | { kind: "FIXED_PRICE"; priceMinor: number };

/**
 * Bundle: one complete bundle = every component at its quantity. Complete bundles =
 * min over components of floor(units / quantity), capped by `limitPerOrder`. Only
 * units in complete bundles are discounted, cheapest first within each component.
 */
export interface BundleConfig {
  type: "BUNDLE";
  /** Shop base currency (ISO 4217) for fixed amounts and prices. */
  currencyCode: string;
  /** 2–5 components, no duplicates. */
  components: BundleComponent[];
  value: BundleValue;
  /** Maximum complete bundles discounted per order (1–100). */
  limitPerOrder: number;
}

/** Discriminated union; free shipping joins here next. */
export type RuleConfig = AmountOffProductsConfig | TieredSpendConfig | BuyXGetYConfig | BundleConfig;
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
  /** Discount on this line (on `quantity` units if set), cart currency minor units. Always > 0. */
  amountMinor: number;
  /**
   * Number of units of the line the discount covers. Absent = the whole line.
   * Sent to Shopify as the cart-line target's `quantity`.
   */
  quantity?: number;
}

export interface OrderDiscount {
  /** Discount on the order subtotal, cart currency minor units (> 0). */
  amountMinor: number;
  /** Index into the rule's tiers of the tier that applied. */
  tierIndex: number;
  /** For percentage tiers: the percent Shopify applies to the order subtotal. */
  percent: number | null;
}

export interface RuleResult {
  ruleId: string;
  discountClass: DiscountClass;
  message: string;
  currencyCode: string;
  /** Product-class rules: per-line discounts. Always [] for order-class rules. */
  lines: LineDiscount[];
  /** Order-class rules: the order discount, or null when no tier is reached. */
  order: OrderDiscount | null;
  totalMinor: number;
}
