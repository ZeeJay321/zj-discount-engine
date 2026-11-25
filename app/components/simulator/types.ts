/** Client-only cart state for the simulator (not persisted). */

export interface SimLine {
  id: string;
  title: string;
  quantity: number;
  /** Unit price as a decimal string in the cart currency (e.g. "19.99"). */
  unitPrice: string;
  productId: string;
  variantId: string;
  collectionIds: string[];
  collectionTitles: Record<string, string>;
}

export interface SimDeliveryOption {
  id: string;
  handle: string;
  /** Cost as a decimal string. */
  cost: string;
}

export interface SimCartState {
  currencyCode: string;
  presentmentCurrencyRate: string;
  lines: SimLine[];
  deliveryOptions: SimDeliveryOption[];
}

export interface SimRuleRow {
  ruleId: string;
  title: string;
  enabled: boolean;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  combinesWith: {
    orderDiscounts: boolean;
    productDiscounts: boolean;
    shippingDiscounts: boolean;
  };
  config: import("@zj/discount-core").RuleConfig;
  typeLabel: string;
}
