import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RuleForm, type RuleFormValues } from "../components/RuleForm";
import { utcIsoToZonedDay } from "../lib/rule-form";
import { formPageContext, handleSave, othersFor } from "../services/rule-form-action.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { repo, shop, ctx } = await formPageContext(request);
  const rules = await repo.list(shop);
  const url = new URL(request.url);
  const values: RuleFormValues = {
    id: "",
    ruleType: ((t) =>
      t === "TIERED_SPEND" || t === "BUY_X_GET_Y" || t === "BUNDLE" || t === "FREE_SHIPPING" ? t : "AMOUNT_OFF_PRODUCTS")(
      url.searchParams.get("type"),
    ),
    title: "",
    priority: String(rules.length ? Math.max(...rules.map((r) => r.priority)) + 1 : 0),
    valueKind: "PERCENTAGE",
    percent: "10",
    amount: "",
    appliesTo: "each",
    tierKind: "PERCENTAGE",
    tiers: [
      { threshold: "", value: "" },
      { threshold: "", value: "" },
    ],
    startDate: utcIsoToZonedDay(new Date().toISOString(), ctx.timezone),
    endDate: "",
    targetKind: "COLLECTIONS",
    targetIds: [],
    buyQuantity: "2",
    getQuantity: "1",
    bogoPercent: "100",
    limitPerOrder: "1",
    components: [
      { kind: "PRODUCT", id: "", productId: "", quantity: "1" },
      { kind: "PRODUCT", id: "", productId: "", quantity: "1" },
    ],
    bundleValueKind: "PERCENTAGE",
    bundleValue: "20",
    shipThreshold: "100.00",
    shipMaxAmount: "",
    shipAppliesTo: "ALL",
    combinesOrder: false,
    combinesProduct: false,
    combinesShipping: true,
  };
  return { values, others: othersFor(rules), ctx };
};

export const action = async ({ request }: ActionFunctionArgs) => handleSave(request, await request.formData());

export default function NewRule() {
  const { values, others, ctx } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  return (
    <s-page heading="New rule">
      <RuleForm
        values={values}
        resourceTitles={{}}
        others={others}
        ctx={ctx}
        serverErrors={actionData && "errors" in actionData ? actionData.errors : undefined}
        submitting={nav.state === "submitting"}
        submitLabel="Create rule"
        isEdit={false}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
