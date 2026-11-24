import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { MAX_CART_LINES } from "@zj/discount-core";
import { describeValue, formatDay } from "../lib/rule-display";
import { appContext } from "../services/app-context.server";
import { quotaSummary } from "../services/discount-quota.server";
import { deleteRule, reconcile, retrySync, revertToSynced, setEnabled } from "../services/discount-sync.server";
import type { SyncStatus } from "../services/rule-repo.server";
import { getCollectionTitles } from "../services/shopify-discounts.server";
import { checkStore } from "../services/store-check.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { deps, repo, shop, gql } = await appContext(request);
  await reconcile(deps); // retry rows left PENDING/DELETING by a crash or timeout
  const [rules, store] = await Promise.all([repo.list(shop), checkStore(gql)]);
  const quota = await quotaSummary(gql, rules, new Date());
  const ids = [...new Set(rules.flatMap((r) => r.config.target.collectionIds))].slice(0, 250);
  let titles: Record<string, string> = {};
  try {
    titles = await getCollectionTitles(gql, ids);
  } catch {
    // cosmetic only
  }
  return {
    store,
    quota,
    rules: rules.map((r) => ({
      id: r.id,
      title: r.title,
      value: describeValue(r.config),
      collections: r.config.target.collectionIds.map((id) => titles[id] ?? id),
      starts: formatDay(r.startsAt, store.timezone),
      ends: formatDay(r.endsAt, store.timezone),
      priority: r.priority,
      enabled: r.enabled,
      syncStatus: r.syncStatus,
      syncError: r.syncError,
      canRevert: r.syncedConfig !== null,
    })),
  };
};

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

const BADGE: Record<SyncStatus, { tone: "success" | "info" | "critical" | "warning"; label: string }> = {
  SYNCED: { tone: "success", label: "Synced" },
  PENDING: { tone: "info", label: "Saving" },
  FAILED: { tone: "critical", label: "Sync failed" },
  DELETING: { tone: "warning", label: "Deleting" },
};

export default function RulesIndex() {
  const { store, quota, rules } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const act = (intent: string, id: string) => fetcher.submit({ intent, id }, { method: "post" });
  const atLimit = quota.used !== null && quota.used >= quota.limit;

  return (
    <s-page heading="Discount rules">
      <s-button slot="primary-action" variant="primary" href="/app/rules/new">
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

      <s-section heading="Store">
        <s-stack direction="block" gap="small-200">
          <s-text>
            Automatic discounts:{" "}
            <s-text type="strong">
              {quota.used === null ? "unknown" : `${quota.used} of ${quota.limit}`} active or scheduled
            </s-text>{" "}
            ({quota.fromApp} from this app). Shopify applies at most {quota.limit} per store, all apps included.
          </s-text>
          {atLimit && <s-text tone="critical">The limit is reached: new or re-enabled rules are blocked.</s-text>}
          <s-text color="subdued">
            Plan: {store.planName}
            {store.isDevelopment ? " (development store)" : store.isPlus ? " (Shopify Plus)" : ""} · Currency {store.currencyCode} · Rules apply to
            carts of up to {MAX_CART_LINES} lines.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Rules" padding="none">
        {rules.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No rules yet. Create one to put a discount on a collection.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Rule</s-table-header>
              <s-table-header>Collections</s-table-header>
              <s-table-header>Dates</s-table-header>
              <s-table-header>Priority</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-link href={`/app/rules/${r.id}`}>{r.title}</s-link>
                      <s-text color="subdued">{r.value}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{r.collections.join(", ")}</s-table-cell>
                  <s-table-cell>
                    {r.starts} → {r.ends}
                  </s-table-cell>
                  <s-table-cell>{r.priority}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small-300">
                        <s-badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</s-badge>
                        <s-badge tone={BADGE[r.syncStatus].tone}>{BADGE[r.syncStatus].label}</s-badge>
                      </s-stack>
                      {r.syncError && <s-text tone="critical">{r.syncError}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      {confirmDelete === r.id ? (
                        <>
                          <s-button tone="critical" variant="primary" onClick={() => { act("delete", r.id); setConfirmDelete(null); }}>
                            Confirm delete
                          </s-button>
                          <s-button variant="tertiary" onClick={() => setConfirmDelete(null)}>
                            Cancel
                          </s-button>
                        </>
                      ) : (
                        <>
                          {(r.syncStatus === "FAILED" || r.syncStatus === "DELETING") && (
                            <s-button onClick={() => act("retry", r.id)}>Retry</s-button>
                          )}
                          {r.syncStatus === "FAILED" && r.canRevert && (
                            <s-button variant="tertiary" onClick={() => act("revert", r.id)}>
                              Revert
                            </s-button>
                          )}
                          <s-button
                            onClick={() => act(r.enabled ? "disable" : "enable", r.id)}
                            {...(!r.enabled && atLimit ? { disabled: true } : {})}
                          >
                            {r.enabled ? "Disable" : "Enable"}
                          </s-button>
                          <s-button tone="critical" variant="tertiary" onClick={() => setConfirmDelete(r.id)}>
                            Delete
                          </s-button>
                        </>
                      )}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
