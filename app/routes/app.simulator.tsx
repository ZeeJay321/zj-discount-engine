import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { SimulatorApp } from "../components/simulator/SimulatorApp";
import type { SimRuleRow } from "../components/simulator/types";
import { RULE_TYPE_LABELS } from "../lib/rule-display";
import { formPageContext } from "../services/rule-form-action.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { repo, shop, ctx } = await formPageContext(request);
  const records = await repo.list(shop);
  const rules: SimRuleRow[] = records
    .filter((r) => r.syncStatus !== "DELETING")
    .map((r) => ({
      ruleId: r.id,
      title: r.title,
      enabled: r.enabled,
      priority: r.priority,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      combinesWith: r.combinesWith,
      config: r.config,
      typeLabel: RULE_TYPE_LABELS[r.config.type],
    }));
  return { rules, shopCurrency: ctx.shopCurrency, timezone: ctx.timezone };
};

export default function SimulatorPage() {
  const { rules, shopCurrency, timezone } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Simulator">
      <s-section>
        <s-paragraph>
          Build a cart in the browser and see what each rule would discount, plus a combined estimate.
          Nothing is saved or applied to Shopify.
        </s-paragraph>
      </s-section>
      <SimulatorApp rules={rules} shopCurrency={shopCurrency} timezone={timezone} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
