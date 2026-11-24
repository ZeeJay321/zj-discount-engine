import db from "../db.server";
import { authenticate } from "../shopify.server";
import type { SyncDeps } from "./discount-sync.server";
import { prismaRuleRepo } from "./rule-repo.server";
import { adminGraphql } from "./shopify-discounts.server";

/** Authenticated per-request dependencies for loaders and actions. */
export async function appContext(request: Request) {
  const { admin, session, redirect } = await authenticate.admin(request);
  const gql = adminGraphql(admin);
  const repo = prismaRuleRepo(db);
  const deps: SyncDeps = { repo, gql, shop: session.shop };
  return { gql, repo, deps, shop: session.shop, redirect };
}
