import type { RuleRepo } from "./rule-repo.server";

export interface ComplianceDeps {
  rules: Pick<RuleRepo, "deleteShopData">;
  deleteSessions: (shop: string) => Promise<void>;
}

/** Normalises "SHOP_REDACT" / "shop/redact" style topics. */
const norm = (topic: string) => topic.toLowerCase().replace(/_/g, "/");

export async function handleComplianceWebhook(topic: string, shop: string, deps: ComplianceDeps): Promise<"redacted" | "no-data"> {
  switch (norm(topic)) {
    case "shop/redact":
      await deps.rules.deleteShopData(shop);
      await deps.deleteSessions(shop);
      return "redacted";
    case "customers/data/request":
    case "customers/redact":
    default:
      // No customer personal data is stored anywhere in this app.
      return "no-data";
  }
}
