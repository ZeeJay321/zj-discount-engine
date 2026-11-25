import { useMemo, useState } from "react";
import { simulate } from "@zj/discount-core";
import { utcIsoToZonedDay, zonedDayToUtcIso } from "../../lib/rule-form";
import { CartBuilder } from "./CartBuilder";
import { parseRate, toCoreCart, toSimulatableRules } from "./cartMath";
import { DeliveryEditor } from "./DeliveryEditor";
import { ResultsPanel } from "./ResultsPanel";
import { RuleChecklist } from "./RuleChecklist";
import type { SimCartState, SimRuleRow } from "./types";

interface Props {
  rules: SimRuleRow[];
  shopCurrency: string;
  timezone: string;
}

function emptyCart(shopCurrency: string): SimCartState {
  return {
    currencyCode: shopCurrency,
    presentmentCurrencyRate: "1",
    lines: [],
    deliveryOptions: [],
  };
}

export function SimulatorApp({ rules, shopCurrency, timezone }: Props) {
  const [cart, setCart] = useState(() => emptyCart(shopCurrency));
  const [selected, setSelected] = useState(() => new Set(rules.filter((r) => r.enabled).map((r) => r.ruleId)));
  const [nowDay, setNowDay] = useState(() => utcIsoToZonedDay(new Date().toISOString(), timezone) || new Date().toISOString().slice(0, 10));

  const result = useMemo(() => {
    const coreCart = toCoreCart(cart);
    const simRules = toSimulatableRules(rules, selected);
    const noonIso = zonedDayToUtcIso(nowDay, timezone, false);
    // Prefer noon local: start-of-day can sit before a same-day startsAt in some zones.
    const now = noonIso
      ? new Date(new Date(noonIso).getTime() + 12 * 60 * 60 * 1000)
      : new Date();
    return simulate(simRules, coreCart, now, {
      presentmentCurrencyRate: parseRate(cart.presentmentCurrencyRate),
    });
  }, [cart, rules, selected, nowDay, timezone]);

  return (
    <s-stack direction="block" gap="large">
      <s-section heading="Cart">
        <CartBuilder state={cart} shopCurrency={shopCurrency} onChange={setCart} />
      </s-section>
      <s-section heading="Delivery options">
        <DeliveryEditor state={cart} onChange={setCart} />
      </s-section>
      <s-section heading="Rules">
        <RuleChecklist
          rules={rules}
          selected={selected}
          onChange={setSelected}
          nowDay={nowDay}
          onNowDay={setNowDay}
          timezone={timezone}
        />
      </s-section>
      <ResultsPanel result={result} currencyCode={cart.currencyCode} />
    </s-stack>
  );
}
