/** Shared server logic for the create/edit rule pages. */
import type { OtherRule } from "@zj/discount-core";
import { errorsByFormField, parseRuleForm } from "../lib/rule-form";
import { appContext } from "./app-context.server";
import { saveRule } from "./discount-sync.server";
import type { RuleRecord } from "./rule-repo.server";
import { checkStore } from "./store-check.server";

export function othersFor(rules: RuleRecord[], excludeId?: string): OtherRule[] {
  return rules
    .filter((r) => r.id !== excludeId && r.syncStatus !== "DELETING")
    .map((r) => ({ id: r.id, title: r.title, enabled: r.enabled, priority: r.priority, startsAt: r.startsAt, endsAt: r.endsAt }));
}

export async function formPageContext(request: Request) {
  const app = await appContext(request);
  const store = await checkStore(app.gql);
  return { ...app, store, ctx: { shopCurrency: store.currencyCode, timezone: store.timezone } };
}

/** Validates (server side, authoritative) and saves; redirects on success. */
export async function handleSave(request: Request, formData: FormData) {
  const { deps, ctx, redirect } = await formPageContext(request);
  const { draft, errors } = parseRuleForm(formData, ctx);
  if (errors.length) return { errors: errorsByFormField(errors) };
  const result = await saveRule(deps, draft);
  if (!result.ok) return { errors: errorsByFormField(result.errors) };
  // A failed Shopify sync keeps the rule (FAILED) and shows Retry/Revert on its page.
  if (result.rule.syncStatus !== "SYNCED") return redirect(`/app/rules/${result.rule.id}`);
  return redirect("/app");
}
