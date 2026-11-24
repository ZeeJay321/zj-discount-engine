import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RuleForm, type RuleFormValues } from "../components/RuleForm";
import { utcIsoToZonedDay } from "../lib/rule-form";
import { formPageContext, handleSave, othersFor } from "../services/rule-form-action.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { repo, shop, ctx } = await formPageContext(request);
  const rules = await repo.list(shop);
  const values: RuleFormValues = {
    id: "",
    title: "",
    priority: String(rules.length ? Math.max(...rules.map((r) => r.priority)) + 1 : 0),
    valueKind: "PERCENTAGE",
    percent: "10",
    amount: "",
    appliesTo: "each",
    startDate: utcIsoToZonedDay(new Date().toISOString(), ctx.timezone),
    endDate: "",
    collectionIds: [],
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
        collectionTitles={{}}
        others={others}
        ctx={ctx}
        serverErrors={actionData && "errors" in actionData ? actionData.errors : undefined}
        submitting={nav.state === "submitting"}
        submitLabel="Create rule"
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
