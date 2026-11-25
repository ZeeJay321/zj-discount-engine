import type { LoaderFunctionArgs } from "react-router";
import { appContext } from "../services/app-context.server";

/**
 * Shopify admin → Discounts → click one of this app's discounts opens this URL
 * (`[extensions.ui.paths] details` in the Function's toml, `:id` = the discount's
 * numeric id). Send the merchant to the matching rule's edit page.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { repo, shop, redirect } = await appContext(request);
  const id = String(params.id ?? "");
  const rule = (await repo.list(shop)).find((r) => r.shopifyDiscountId !== null && r.shopifyDiscountId.split("/").pop() === id);
  return redirect(rule ? `/app/rules/${rule.id}` : "/app");
};
