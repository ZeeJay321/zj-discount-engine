/**
 * Public offer summary for the headless storefront.
 *
 * A rule's own config lives in the discount's `$app` metafield, which only this app can
 * read. So the storefront can tell shoppers "add 1 more — the cheapest is free", we also
 * publish the live Buy X Get Y rules to ONE shop metafield (`$app:public_offers`) whose
 * definition in shopify.app.toml grants Storefront API public read. The storefront reads
 * it as namespace `app--<this app's id>`.
 *
 * Only what Shopify already runs is published (syncedConfig, enabled). Dates are passed
 * through; the storefront filters by them. No customer data — titles, product/collection
 * ids and quantities only.
 */
import type { ProductTarget } from "@zj/discount-core";
import type { RuleRecord } from "./rule-repo.server";
import type { AdminGraphql } from "./shopify-discounts.server";

export const PUBLIC_OFFERS_KEY = "public_offers";
export const PUBLIC_OFFERS_VERSION = 1;

export interface PublicOffer {
  type: "BUY_X_GET_Y";
  title: string;
  startsAt: string;
  endsAt: string | null;
  buyQuantity: number;
  getQuantity: number;
  /** 100 = free. */
  percent: number;
  limitPerOrder: number;
  target: ProductTarget;
}

export interface PublicOffersPayload {
  version: number;
  offers: PublicOffer[];
}

/** Live Buy X Get Y rules as Shopify has them, highest priority first. Pure. */
export function publicOffers(rules: RuleRecord[]): PublicOffersPayload {
  const offers = rules
    .filter((r) => r.syncStatus !== "DELETING" && r.shopifyDiscountId && r.syncedConfig?.enabled)
    .map((r) => r.syncedConfig!)
    .sort((a, b) => a.priority - b.priority)
    .flatMap((s): PublicOffer[] =>
      s.config.type === "BUY_X_GET_Y"
        ? [
            {
              type: "BUY_X_GET_Y",
              title: s.title,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              buyQuantity: s.config.buyQuantity,
              getQuantity: s.config.getQuantity,
              percent: s.config.percent,
              limitPerOrder: s.config.limitPerOrder,
              target: s.config.target,
            },
          ]
        : [],
    );
  return { version: PUBLIC_OFFERS_VERSION, offers };
}

const READ = `#graphql
  query ZjPublicOffers {
    shop {
      id
      metafield(namespace: "$app", key: "${PUBLIC_OFFERS_KEY}") { value }
    }
  }`;

const WRITE = `#graphql
  mutation ZjSetPublicOffers($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message code }
    }
  }`;

/**
 * Writes the summary when it differs from what's published (one read; a write only on
 * change). Throws on failure — callers treat it as best effort.
 */
export async function publishOffers(gql: AdminGraphql, rules: RuleRecord[]): Promise<"unchanged" | "written"> {
  const value = JSON.stringify(publicOffers(rules));
  const data = await gql<{ shop: { id: string; metafield: { value: string } | null } }>(READ);
  if (data.shop.metafield?.value === value) return "unchanged";
  const res = await gql<{ metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] } }>(WRITE, {
    metafields: [{ ownerId: data.shop.id, namespace: "$app", key: PUBLIC_OFFERS_KEY, type: "json", value }],
  });
  if (res.metafieldsSet.userErrors.length > 0) {
    throw new Error(res.metafieldsSet.userErrors.map((e) => e.message).join("; "));
  }
  return "written";
}
