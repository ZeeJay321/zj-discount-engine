/**
 * Functions in custom-distribution apps only run on Shopify Plus and development
 * stores. This check makes that visible in the app instead of discounts silently
 * not applying.
 */
import { errorMessage, getShopInfo, type AdminGraphql, type ShopInfo } from "./shopify-discounts.server";

export interface StoreCheck {
  ok: boolean;
  isDevelopment: boolean;
  isPlus: boolean;
  planName: string;
  currencyCode: string;
  timezone: string;
  error?: string;
}

export function evaluateStore(info: ShopInfo): StoreCheck {
  const { partnerDevelopment, shopifyPlus, publicDisplayName } = info.plan;
  return {
    ok: partnerDevelopment || shopifyPlus,
    isDevelopment: partnerDevelopment,
    isPlus: shopifyPlus,
    planName: publicDisplayName,
    currencyCode: info.currencyCode,
    timezone: info.ianaTimezone,
  };
}

export async function checkStore(gql: AdminGraphql): Promise<StoreCheck> {
  try {
    return evaluateStore(await getShopInfo(gql));
  } catch (err) {
    return {
      ok: false,
      isDevelopment: false,
      isPlus: false,
      planName: "unknown",
      currencyCode: "USD",
      timezone: "UTC",
      error: errorMessage(err),
    };
  }
}
