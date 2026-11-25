import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { RuleForm, type RuleFormValues } from "../components/RuleForm";
import { collectionIdsOf, productIdsOf } from "@zj/discount-core";
import { draftToFormValues } from "../lib/rule-form";
import { retrySync, revertToSynced } from "../services/discount-sync.server";
import { formPageContext, handleSave, othersFor } from "../services/rule-form-action.server";
import { getResourceTitles } from "../services/shopify-discounts.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { repo, shop, ctx, gql } = await formPageContext(request);
  const rules = await repo.list(shop);
  const rule = rules.find((r) => r.id === params.id);
  if (!rule) throw new Response("Rule not found", { status: 404 });
  const values = draftToFormValues({ ...rule, id: rule.id }, ctx) as RuleFormValues;
  let resourceTitles: Record<string, string> = {};
  try {
    resourceTitles = await getResourceTitles(gql, [...collectionIdsOf(rule.config), ...productIdsOf(rule.config)]);
  } catch {
    // titles are cosmetic; fall back to IDs
  }
  return {
    values,
    resourceTitles,
    others: othersFor(rules, rule.id),
    ctx,
    sync: { status: rule.syncStatus, error: rule.syncError, canRevert: rule.syncedConfig !== null },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "retry" || intent === "revert") {
    const { deps } = await formPageContext(request);
    if (intent === "retry") await retrySync(deps, String(params.id));
    else {
      const res = await revertToSynced(deps, String(params.id));
      if (!res.ok) return { errors: { form: res.errors[0]?.message ?? "Couldn't revert." } };
    }
    return { ok: true };
  }
  formData.set("id", String(params.id));
  return handleSave(request, formData);
};

export default function EditRule() {
  const { values, resourceTitles, others, ctx, sync } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <s-page heading={`Edit: ${values.title}`}>
      {sync.status === "FAILED" && (
        <s-banner tone="critical" heading="This rule isn't in sync with Shopify">
          <s-paragraph>
            {"The last change wasn't saved to Shopify, so checkout still uses the previous version."}
            {sync.error ? ` Shopify said: ${sync.error}` : ""}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => fetcher.submit({ intent: "retry" }, { method: "post" })} {...(busy ? { loading: true } : {})}>
              Retry sync
            </s-button>
            {sync.canRevert && (
              <s-button variant="tertiary" onClick={() => fetcher.submit({ intent: "revert" }, { method: "post" })}>
                Revert to live version
              </s-button>
            )}
          </s-stack>
        </s-banner>
      )}
      {sync.status === "PENDING" && (
        <s-banner tone="info" heading="Saving to Shopify…">
          <s-paragraph>{"If this doesn't clear, it will be retried automatically when you open the rules list."}</s-paragraph>
        </s-banner>
      )}
      <RuleForm
        key={JSON.stringify(values)}
        values={values}
        resourceTitles={resourceTitles}
        others={others}
        ctx={ctx}
        serverErrors={actionData && "errors" in actionData ? (actionData.errors as Record<string, string>) : undefined}
        submitting={nav.state === "submitting"}
        submitLabel="Save rule"
        isEdit
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
