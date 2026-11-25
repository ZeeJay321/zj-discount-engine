import { TIER_BASIS, type SimulateResult } from "@zj/discount-core";
import { formatMoneyMinor } from "../../lib/rule-display";

interface Props {
  result: SimulateResult | null;
  currencyCode: string;
}

const REASON_LABEL: Record<string, string> = {
  outside_dates: "Outside date window",
  above_line_cap: "Above cart-line cap",
  empty_cart: "Empty cart",
  below_threshold: "Below threshold",
  no_matching_lines: "No matching lines",
  no_delivery_options: "No delivery options",
  no_discount: "No discount",
};

export function ResultsPanel({ result, currencyCode }: Props) {
  if (!result) {
    return <s-text color="subdued">Change the cart or rules to see results.</s-text>;
  }

  const money = (n: number) => formatMoneyMinor(n, currencyCode);

  return (
    <s-stack direction="block" gap="base">
      <s-section heading="Per rule">
        <s-table>
          <s-table-header-row>
            <s-table-header>Rule</s-table-header>
            <s-table-header>Class</s-table-header>
            <s-table-header>Total</s-table-header>
            <s-table-header>Detail</s-table-header>
            <s-table-header>In estimate</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {result.perRule.map((row) => (
              <s-table-row key={row.ruleId}>
                <s-table-cell>{row.title}</s-table-cell>
                <s-table-cell>{row.discountClass}</s-table-cell>
                <s-table-cell>{money(row.result.totalMinor)}</s-table-cell>
                <s-table-cell>
                  {row.reason ? (
                    <s-stack direction="block" gap="none">
                      <s-text>{REASON_LABEL[row.reason] ?? row.reason}</s-text>
                      {row.reasonDetail && <s-text color="subdued">{row.reasonDetail}</s-text>}
                    </s-stack>
                  ) : (
                    <s-text color="subdued">
                      {row.result.lines.length
                        ? `${row.result.lines.length} line(s)`
                        : row.result.shipping.length
                          ? `${row.result.shipping.length} option(s)`
                          : row.result.order
                            ? `tier ${row.result.order.tierIndex}`
                            : "—"}
                    </s-text>
                  )}
                </s-table-cell>
                <s-table-cell>{row.includedInEstimate ? "Yes" : "—"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="Combined estimate">
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">Total {money(result.combinedTotalMinor)}</s-text>
          <s-text color="subdued">
            Product {money(result.productTotalMinor)} · Order {money(result.orderTotalMinor)} · Shipping{" "}
            {money(result.shippingTotalMinor)}
          </s-text>
          <s-text color="subdued">Tier basis: {result.tierBasis} (default {TIER_BASIS})</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Assumptions">
        <s-unordered-list>
          <s-list-item>
            Combination is a greedy estimate: best-first within each class; stack only when both rules allow
            that class.
          </s-list-item>
          <s-list-item>Product discounts are applied before order % / tiers when tier basis is after product.</s-list-item>
          <s-list-item>
            Shipping is estimated in its own bucket and never folded into product/order money.
          </s-list-item>
          <s-list-item>End dates are exclusive; disabled or out-of-window rules are skipped.</s-list-item>
          <s-list-item>Product rules above their measured cart-line cap give no discount.</s-list-item>
          <s-list-item>Browser-only — nothing is saved or applied to Shopify.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-stack>
  );
}
