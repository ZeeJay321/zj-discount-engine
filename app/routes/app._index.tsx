import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppLink, useAppNavigate } from "../components/AppLink";
import { MAX_CART_LINES_BY_TYPE, resourceIdsOf } from "@zj/discount-core";
import { describeTiers, describeValue, formatDay, RULE_TYPE_LABELS } from "../lib/rule-display";
import { appContext } from "../services/app-context.server";
import { quotaSummary } from "../services/discount-quota.server";
import { deleteRule, reconcile, retrySync, revertToSynced, setEnabled } from "../services/discount-sync.server";
import type { SyncStatus } from "../services/rule-repo.server";
import { publishOffers } from "../services/public-offers.server";
import { getResourceTitles } from "../services/shopify-discounts.server";
import { checkStore } from "../services/store-check.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { deps, repo, shop, gql } = await appContext(request);
  await reconcile(deps); // retry rows left PENDING/DELETING by a crash or timeout
  const [rules, store] = await Promise.all([repo.list(shop), checkStore(gql)]);
  const quota = await quotaSummary(gql, rules, new Date());
  // This list reloads after every save / enable / disable / delete, so publishing here
  // keeps the storefront's offer summary current. Best effort: it only drives a hint.
  try {
    await publishOffers(gql, rules);
  } catch (err) {
    console.warn("[public-offers] publish failed:", err instanceof Error ? err.message : String(err));
  }
  const ids = [...new Set(rules.flatMap((r) => resourceIdsOf(r.config)))].slice(0, 250);
  let titles: Record<string, string> = {};
  try {
    titles = await getResourceTitles(gql, ids);
  } catch {
    // cosmetic only
  }
  return {
    store,
    quota,
    rules: rules.map((r) => {
      const appliesTo =
        r.config.type === "TIERED_SPEND"
          ? "Whole order"
          : r.config.type === "FREE_SHIPPING"
            ? r.config.appliesTo === "CHEAPEST"
              ? "Cheapest shipping"
              : "All shipping options"
            : resourceIdsOf(r.config)
                .map((id) => titles[id] ?? id)
                .join(r.config.type === "BUNDLE" ? " + " : ", ");
      return {
        id: r.id,
        title: r.title,
        type: RULE_TYPE_LABELS[r.config.type],
        valueLines: r.config.type === "TIERED_SPEND" ? describeTiers(r.config) : [describeValue(r.config, titles)],
        appliesTo: truncate(appliesTo, 72),
        starts: formatDay(r.startsAt, store.timezone),
        ends: formatDay(r.endsAt, store.timezone),
        priority: r.priority,
        enabled: r.enabled,
        syncStatus: r.syncStatus,
        syncError: r.syncError,
        canRevert: r.syncedConfig !== null,
      };
    }),
  };
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { deps } = await appContext(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  switch (form.get("intent")) {
    case "enable":
    case "disable": {
      const res = await setEnabled(deps, id, form.get("intent") === "enable");
      return res.ok ? { ok: true } : { ok: false, error: res.errors.map((e) => e.message).join(" ") };
    }
    case "retry":
      await retrySync(deps, id);
      return { ok: true };
    case "revert": {
      const res = await revertToSynced(deps, id);
      return res.ok ? { ok: true } : { ok: false, error: res.errors[0]?.message };
    }
    case "delete": {
      const res = await deleteRule(deps, id);
      return res.ok ? { ok: true } : { ok: false, error: `Couldn't delete the Shopify discount: ${res.error}` };
    }
    default:
      return { ok: false, error: "Unknown action." };
  }
};

const SYNC_BADGE: Record<SyncStatus, { tone: "success" | "info" | "critical" | "warning" | "neutral"; label: string }> = {
  SYNCED: { tone: "success", label: "Synced" },
  PENDING: { tone: "info", label: "Saving" },
  FAILED: { tone: "critical", label: "Sync failed" },
  DELETING: { tone: "warning", label: "Deleting" },
};

export default function RulesIndex() {
  const { store, quota, rules } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const go = useAppNavigate();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const act = (intent: string, id: string) => fetcher.submit({ intent, id }, { method: "post" });
  const atLimit = quota.used !== null && quota.used >= quota.limit;
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Discount rules">
      <s-button slot="primary-action" variant="primary" onClick={() => go("/app/rules/new")}>
        New rule
      </s-button>

      {!store.ok && (
        <s-banner tone="critical" heading="Discounts from this app won't run on this store">
          <s-paragraph>
            {store.error
              ? `Couldn't check the store plan: ${store.error}`
              : `This store is on "${store.planName}". Shopify only runs Functions from custom apps on Shopify Plus and development stores, so rules will save but never apply at checkout.`}
          </s-paragraph>
        </s-banner>
      )}

      {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
        <s-banner tone="critical" heading="That didn't work">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-text>
            Automatic discounts:{" "}
            <s-text type="strong">
              {quota.used === null ? "unknown" : `${quota.used} of ${quota.limit}`}
            </s-text>{" "}
            active or scheduled ({quota.fromApp} from this app). Shopify applies at most {quota.limit} per store.
          </s-text>
          {atLimit && <s-text tone="critical">Limit reached — new or re-enabled rules are blocked.</s-text>}
          <s-text color="subdued">
            {store.planName}
            {store.isDevelopment ? " · Development store" : store.isPlus ? " · Shopify Plus" : ""} · {store.currencyCode} ·
            Product rules capped at {MAX_CART_LINES_BY_TYPE.AMOUNT_OFF_PRODUCTS} / {MAX_CART_LINES_BY_TYPE.BUY_X_GET_Y} /{" "}
            {MAX_CART_LINES_BY_TYPE.BUNDLE} lines (amount off / buy X get Y / bundle). Tiered spend and free shipping are
            uncapped.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Rules" padding="none">
        {rules.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No rules yet. Create one to discount products, the order, a bundle, or shipping.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rule</s-table-header>
              <s-table-header listSlot="secondary">Offer</s-table-header>
              <s-table-header listSlot="labeled">Applies to</s-table-header>
              <s-table-header listSlot="labeled">Dates</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled">Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((r) => {
                const sync = SYNC_BADGE[r.syncStatus];
                return (
                  <s-table-row key={r.id} clickDelegate={`edit-${r.id}`}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        <AppLink id={`edit-${r.id}`} to={`/app/rules/${r.id}`}>
                          {r.title}
                        </AppLink>
                        <s-stack direction="inline" gap="small-200">
                          <s-badge>{r.type}</s-badge>
                          <s-text color="subdued">P{r.priority}</s-text>
                        </s-stack>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="none">
                        {r.valueLines.map((line, i) => (
                          <s-text key={i}>{line}</s-text>
                        ))}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{r.appliesTo || "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="none">
                        <s-text>{r.starts}</s-text>
                        <s-text color="subdued">→ {r.ends}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "On" : "Off"}</s-badge>
                        {r.syncStatus !== "SYNCED" && <s-badge tone={sync.tone}>{sync.label}</s-badge>}
                      </s-stack>
                      {r.syncError && <s-text tone="critical">{r.syncError}</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      {confirmDelete === r.id ? (
                        <s-stack direction="inline" gap="small-200">
                          <s-button
                            tone="critical"
                            variant="primary"
                            {...(busy ? { loading: true } : {})}
                            onClick={() => {
                              act("delete", r.id);
                              setConfirmDelete(null);
                            }}
                          >
                            Delete
                          </s-button>
                          <s-button variant="tertiary" onClick={() => setConfirmDelete(null)}>
                            Cancel
                          </s-button>
                        </s-stack>
                      ) : (
                        <s-stack direction="inline" gap="small-200">
                          <s-button
                            variant="tertiary"
                            onClick={() => act(r.enabled ? "disable" : "enable", r.id)}
                            {...(!r.enabled && atLimit ? { disabled: true } : {})}
                            {...(busy ? { loading: true } : {})}
                          >
                            {r.enabled ? "Disable" : "Enable"}
                          </s-button>
                          {(r.syncStatus === "FAILED" || r.syncStatus === "DELETING") && (
                            <s-button variant="tertiary" onClick={() => act("retry", r.id)} {...(busy ? { loading: true } : {})}>
                              Retry
                            </s-button>
                          )}
                          {r.syncStatus === "FAILED" && r.canRevert && (
                            <s-button variant="tertiary" onClick={() => act("revert", r.id)}>
                              Revert
                            </s-button>
                          )}
                          <s-button tone="critical" variant="tertiary" onClick={() => setConfirmDelete(r.id)}>
                            Delete
                          </s-button>
                        </s-stack>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
