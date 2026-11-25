import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form } from "react-router";
import { useAppNavigate } from "./AppLink";
import { MAX_CART_LINES, MAX_TIERS, MIN_TIERS, validateRule, type OtherRule, type RuleType } from "@zj/discount-core";
import { describeBuyXGetY, describeTiers, RULE_TYPE_LABELS } from "../lib/rule-display";
import { TargetPicker, type TargetKind } from "./TargetPicker";
import { errorsByFormField, parseRuleForm, type FormContext } from "../lib/rule-form";

export interface RuleFormValues {
  id: string;
  ruleType: RuleType;
  title: string;
  priority: string;
  valueKind: "PERCENTAGE" | "FIXED_AMOUNT";
  percent: string;
  amount: string;
  appliesTo: "each" | "once";
  tierKind: "PERCENTAGE" | "FIXED_AMOUNT";
  tiers: Array<{ threshold: string; value: string }>;
  startDate: string;
  endDate: string;
  targetKind: TargetKind;
  targetIds: string[];
  buyQuantity: string;
  getQuantity: string;
  bogoPercent: string;
  limitPerOrder: string;
  combinesOrder: boolean;
  combinesProduct: boolean;
  combinesShipping: boolean;
}

interface Props {
  values: RuleFormValues;
  /** id → title for chosen collections/products. */
  resourceTitles: Record<string, string>;
  /** Other rules of the shop, for the same-priority overlap check before submit. */
  others: OtherRule[];
  ctx: FormContext;
  /** Errors returned by the server action, keyed by form field. */
  serverErrors?: Record<string, string>;
  submitting: boolean;
  submitLabel: string;
  /** Editing an existing rule: the type is fixed (Shopify can't change a discount's class). */
  isEdit: boolean;
}

const checked = (on: boolean) => (on ? { checked: true } : {});
let tierKeySeq = 0;
const newTierKey = () => `tier-${++tierKeySeq}`;

/** React 18 doesn't wire custom-element events from props; listen on the element directly. */
function useElementValue<T extends string>(initial: T, parse: (v: string) => T) {
  const [value, setValue] = useState<T>(initial);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => setValue(parse(String(el.value)));
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [value, ref] as const;
}

const asKind = (v: string) => (v === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE") as "PERCENTAGE" | "FIXED_AMOUNT";
const asType = (v: string) => (v === "TIERED_SPEND" || v === "BUY_X_GET_Y" ? v : "AMOUNT_OFF_PRODUCTS") as RuleType;

export function RuleForm({ values, resourceTitles, others, ctx, serverErrors, submitting, submitLabel, isEdit }: Props) {
  const go = useAppNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>(serverErrors ?? {});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [ruleType, typeRef] = useElementValue<RuleType>(values.ruleType, asType);
  const [valueKind, kindRef] = useElementValue(values.valueKind, asKind);
  const [tierKind, tierKindRef] = useElementValue(values.tierKind, asKind);
  const [tiers, setTiers] = useState(() => values.tiers.map((t) => ({ ...t, key: newTierKey() })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bogoPercentRef = useRef<any>(null);

  useEffect(() => setErrors(serverErrors ?? {}), [serverErrors]);

  /** Parse + validate the current form contents with the shared core. */
  function check() {
    const form = formRef.current;
    if (!form) return null;
    const { draft, errors: parseErrors } = parseRuleForm(new FormData(form), ctx);
    const all = [...parseErrors, ...validateRule(draft, others)];
    return { draft, all };
  }

  // Live preview (tiers / buy X get Y), and live validation once a submit was attempted.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const refresh = () => {
      const res = check();
      if (!res) return;
      const c = res.draft.config;
      setPreview(c.type === "TIERED_SPEND" ? describeTiers(c) : c.type === "BUY_X_GET_Y" ? [describeBuyXGetY(c)] : []);
      if (triedSubmit) setErrors(errorsByFormField(res.all));
    };
    refresh();
    // Capture phase: catches input/change from the form-associated Polaris fields.
    form.addEventListener("input", refresh, true);
    form.addEventListener("change", refresh, true);
    return () => {
      form.removeEventListener("input", refresh, true);
      form.removeEventListener("change", refresh, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triedSubmit, ruleType, tierKind, tiers.length]);

  /** "Make it free": set the percentage to 100 and let the preview/validation refresh. */
  function makeFree() {
    const el = bogoPercentRef.current;
    if (!el) return;
    el.value = "100";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    setTriedSubmit(true);
    const res = check();
    if (res && res.all.length > 0) {
      event.preventDefault();
      setErrors(errorsByFormField(res.all));
    } else {
      setErrors({});
    }
  }

  const err = (k: string) => (errors[k] ? { error: errors[k] } : {});
  const cur = ctx.shopCurrency;

  return (
    <Form method="post" onSubmit={onSubmit} ref={formRef}>
      <input type="hidden" name="intent" value="save" />
      {values.id && <input type="hidden" name="id" value={values.id} />}

      {errors.form && (
        <s-banner tone="critical" heading="The rule couldn't be saved">
          <s-paragraph>{errors.form}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Rule">
        <s-stack direction="block" gap="base">
          {isEdit ? (
            <>
              <input type="hidden" name="ruleType" value={ruleType} />
              <s-text>
                Type: <s-text type="strong">{RULE_TYPE_LABELS[ruleType]}</s-text>
              </s-text>
              <s-text color="subdued">
                The type can&apos;t be changed after a rule is created, because Shopify doesn&apos;t allow changing a
                discount&apos;s class. Create a new rule for a different type.
              </s-text>
            </>
          ) : (
            <s-select label="Rule type" name="ruleType" value={ruleType} ref={typeRef}>
              <s-option value="AMOUNT_OFF_PRODUCTS">{RULE_TYPE_LABELS.AMOUNT_OFF_PRODUCTS}</s-option>
              <s-option value="TIERED_SPEND">{RULE_TYPE_LABELS.TIERED_SPEND} (spend X, get Y off the order)</s-option>
              <s-option value="BUY_X_GET_Y">{RULE_TYPE_LABELS.BUY_X_GET_Y} (cheapest units discounted)</s-option>
            </s-select>
          )}
          <s-text-field label="Title" name="title" value={values.title} details="Shown to customers at checkout." {...err("title")} />
          <s-number-field label="Priority" name="priority" value={values.priority} min={0} max={1000} step={1}
            details="Two enabled rules with the same priority can't overlap in dates." {...err("priority")} />
        </s-stack>
      </s-section>

      {ruleType !== "TIERED_SPEND" && (
        <s-section heading="Products">
          <TargetPicker kind={values.targetKind} ids={values.targetIds} titles={resourceTitles} error={errors.targetIds} />
        </s-section>
      )}

      {ruleType === "BUY_X_GET_Y" && (
        <s-section heading="Buy X get Y">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Every set of buy + get units from these products earns the get units at a discount. The cheapest units in
              the cart are the ones discounted (equal prices: the earlier cart line first).
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-number-field label="Customer buys" name="buyQuantity" value={values.buyQuantity} min={1} max={100} step={1} suffix="units" {...err("buyQuantity")} />
              <s-number-field label="Customer gets" name="getQuantity" value={values.getQuantity} min={1} max={100} step={1} suffix="units" {...err("getQuantity")} />
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-number-field label="Discount on the get units" name="bogoPercent" value={values.bogoPercent} min={0.01} max={100} step={0.01}
                suffix="%" ref={bogoPercentRef} {...err("bogoPercent")} />
              <s-button variant="tertiary" onClick={makeFree}>Make it free</s-button>
            </s-stack>
            <s-number-field label="Limit per order" name="limitPerOrder" value={values.limitPerOrder} min={1} max={100} step={1}
              suffix="times" details="How many times the offer can apply in one order (1–100)." {...err("limitPerOrder")} />
            <s-text color="subdued">
              Applies to carts with up to {MAX_CART_LINES} lines. Larger carts get no discount from this rule
              (Shopify Function instruction limit).
            </s-text>
            {preview.length > 0 && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">Preview</s-text>
                  <s-text>{preview[0]}</s-text>
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-section>
      )}

      {ruleType === "AMOUNT_OFF_PRODUCTS" ? (
        <>

          <s-section heading="Value">
            <s-stack direction="block" gap="base">
              <s-select label="Discount type" name="valueKind" value={valueKind} ref={kindRef} {...err("valueKind")}>
                <s-option value="PERCENTAGE">Percentage</s-option>
                <s-option value="FIXED_AMOUNT">Fixed amount ({cur})</s-option>
              </s-select>
              {valueKind === "PERCENTAGE" ? (
                <s-number-field label="Percentage off" name="percent" value={values.percent} min={0.01} max={100} step={0.01} suffix="%" {...err("percent")} />
              ) : (
                <>
                  <s-text-field label={`Amount off (${cur})`} name="amount" value={values.amount} placeholder="5.00"
                    details="In the store's currency; converted at checkout for other currencies." {...err("amount")} />
                  <s-select label="Applies" name="appliesTo" value={values.appliesTo} {...err("appliesTo")}>
                    <s-option value="each">To each eligible item</s-option>
                    <s-option value="once">Once per order, split across eligible items</s-option>
                  </s-select>
                </>
              )}
              <s-text color="subdued">
                Applies to carts with up to {MAX_CART_LINES} lines. Larger carts get no discount from this rule
                (Shopify Function instruction limit).
              </s-text>
            </s-stack>
          </s-section>
        </>
      ) : ruleType !== "TIERED_SPEND" ? null : (
        <s-section heading="Tiers">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              The highest tier the cart subtotal reaches applies, to the whole order. Exactly at a threshold counts.
              No cart-size limit for this rule type.
            </s-paragraph>
            <s-select label="Discount per tier" name="tierKind" value={tierKind} ref={tierKindRef}>
              <s-option value="PERCENTAGE">Percentage off the order</s-option>
              <s-option value="FIXED_AMOUNT">Fixed amount off the order ({cur})</s-option>
            </s-select>
            {tiers.map((t, i) => (
              <s-stack key={t.key} direction="inline" gap="base">
                <s-text-field label={`Tier ${i + 1}: spend (${cur}) or more`} name="tierThreshold" value={t.threshold}
                  placeholder={String((i + 1) * 100)} {...err(`tierThreshold.${i}`)} />
                {tierKind === "PERCENTAGE" ? (
                  <s-number-field label="Percentage off" name="tierValue" value={t.value} min={0.01} max={100} step={0.01}
                    suffix="%" {...err(`tierValue.${i}`)} />
                ) : (
                  <s-text-field label={`Amount off (${cur})`} name="tierValue" value={t.value} placeholder="10.00" {...err(`tierValue.${i}`)} />
                )}
                {tiers.length > MIN_TIERS && (
                  <s-button variant="tertiary" tone="critical" onClick={() => setTiers((rows) => rows.filter((r) => r.key !== t.key))}>
                    Remove
                  </s-button>
                )}
              </s-stack>
            ))}
            {errors.tiers && <s-text tone="critical">{errors.tiers}</s-text>}
            {tiers.length < MAX_TIERS && (
              <s-button onClick={() => setTiers((rows) => [...rows, { threshold: "", value: "", key: newTierKey() }])}>Add tier</s-button>
            )}
            {preview.length > 0 && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">Preview</s-text>
                  {preview.map((line, i) => (
                    <s-text key={i}>{line}</s-text>
                  ))}
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section heading="Active dates">
        <s-stack direction="block" gap="base">
          <s-date-field label="Start date" name="startDate" value={values.startDate} details={`Starts at 00:00 (${ctx.timezone}).`} {...err("startDate")} />
          <s-date-field label="End date (optional)" name="endDate" value={values.endDate} details={`Ends at 23:59 (${ctx.timezone}).`} {...err("endDate")} />
        </s-stack>
      </s-section>

      <s-section heading="Combinations">
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">This discount can be combined with:</s-text>
          <s-checkbox label="Product discounts" name="combinesProduct" value="on" {...checked(values.combinesProduct)} />
          <s-checkbox label="Order discounts" name="combinesOrder" value="on" {...checked(values.combinesOrder)} />
          <s-checkbox label="Shipping discounts" name="combinesShipping" value="on" {...checked(values.combinesShipping)} />
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="base">
        <s-button type="submit" variant="primary" {...(submitting ? { loading: true } : {})}>
          {submitLabel}
        </s-button>
        <s-button onClick={() => go("/app")}>Cancel</s-button>
      </s-stack>
    </Form>
  );
}
