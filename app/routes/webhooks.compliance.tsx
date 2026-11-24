import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { handleComplianceWebhook } from "../services/compliance.server";
import { prismaRuleRepo } from "../services/rule-repo.server";
import { authenticate } from "../shopify.server";

/**
 * Mandatory privacy webhooks. authenticate.webhook verifies the HMAC (401 otherwise).
 * The app stores no customer personal data, so customer requests need no action;
 * shop/redact removes everything the app holds for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  await handleComplianceWebhook(topic, shop, {
    rules: prismaRuleRepo(db),
    deleteSessions: async (s) => {
      await db.session.deleteMany({ where: { shop: s } });
    },
  });
  return new Response(null, { status: 200 });
};
