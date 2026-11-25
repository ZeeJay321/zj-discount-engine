import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/** Shopify admin → Discounts → Create discount → this app: open the new-rule form. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app/rules/new");
};
