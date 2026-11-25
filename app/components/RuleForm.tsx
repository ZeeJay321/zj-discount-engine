import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form } from "react-router";
import { useAppNavigate } from "./AppLink";
import { maxCartLinesFor, MAX_TIERS, MIN_TIERS, validateRule, type OtherRule, type RuleType } from "@zj/discount-core";
import { describeBundle, describeBuyXGetY, describeFreeShipping, describeTiers, RULE_TYPE_LABELS } from "../lib/rule-display";
import { BundleEditor, type ComponentRow } from "./BundleEditor";
import { Checkbox } from "./Checkbox";
import { Select } from "./Select";
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
  components: ComponentRow[];
  bundleValueKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE";
  bundleValue: string;
  shipThreshold: string;
  shipMaxAmount: string;
  shipAppliesTo: "ALL" | "CHEAPEST";
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

let tierKeySeq = 0;
const newTierKey = () => `tier-${++tierKeySeq}`;

const asKind = (v: string) => (v === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE") as "PERCENTAGE" | "FIXED_AMOUNT";
const asType = (v: string) =>
  (v === "TIERED_SPEND" || v === "BUY_X_GET_Y" || v === "BUNDLE" || v === "FREE_SHIPPING" ? v : "AMOUNT_OFF_PRODUCTS") as RuleType;

export function RuleForm({ values, resourceTitles, others, ctx, serverErrors, submitting, submitLabel, isEdit }: Props) {
  const go = useAppNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>(serverErrors ?? {});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [ruleType, setRuleType] = useState<RuleType>(values.ruleType);
  const [valueKind, setValueKind] = useState(values.valueKind);
  const [tierKind, setTierKind] = useState(values.tierKind);
  const [appliesTo, setAppliesTo] = useState(values.appliesTo);
  const [shipAppliesTo, setShipAppliesTo] = useState(values.shipAppliesTo);
  const [bundleTitles, setBundleTitles] = useState<Record<string, string>>(resourceTitles);
  const [componentCount, setComponentCount] = useState(values.components.length);
  const cap = maxCartLinesFor(ruleType);
  const [tiers, setTiers] = useState(() => values.tiers.map((t) => ({ ...t, key: newTierKey() })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bogoPercentRef = useRef<any>(null);

  useEffect(() => setErrors(serverErrors ?? {}), [serverErrors]);

  // React 18 sets only *attributes* on custom elements. Polaris fields don't all read
  // their initial `value` / `checked` attribute, so a saved value could show wrong (the
  // same bug the Select wrapper fixes). Copy each field's initial attribute into its
  // property ONCE, when the field first appears — never afterwards, so typing is kept.
  const initialised = useRef(new WeakSet<Element>());
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.querySelectorAll("s-text-field, s-number-field, s-date-field").forEach((node) => {
      if (initialised.current.has(node)) return;
      initialised.current.add(node);
      const el = node as unknown as { value?: string };
      const attr = node.getAttribute("value");
      if (attr !== null && el.value !== attr) el.value = attr;
    });
  });

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
      setPreview(
        c.type === "TIERED_SPEND"
          ? describeTiers(c)
          : c.type === "BUY_X_GET_Y"
            ? [describeBuyXGetY(c)]
            : c.type === "BUNDLE"
              ? [describeBundle(c, bundleTitles)]
              : c.type === "FREE_SHIPPING"
                ? [describeFreeShipping(c)]
                : [],
      );
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
  }, [triedSubmit, ruleType, tierKind, tiers.length, componentCount, bundleTitles]);

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
            <Select
              label="Rule type"
              name="ruleType"
              value={ruleType}
              onChange={(v) => setRuleType(asType(v))}
              options={[
                { value: "AMOUNT_OFF_PRODUCTS", label: RULE_TYPE_LABELS.AMOUNT_OFF_PRODUCTS },
                { value: "TIERED_SPEND", label: `${RULE_TYPE_LABELS.TIERED_SPEND} (spend X, get Y off the order)` },
                { value: "BUY_X_GET_Y", label: `${RULE_TYPE_LABELS.BUY_X_GET_Y} (cheapest units discounted)` },
                { value: "BUNDLE", label: `${RULE_TYPE_LABELS.BUNDLE} (these items together get a price off)` },
                { value: "FREE_SHIPPING", label: `${RULE_TYPE_LABELS.FREE_SHIPPING} (above a cart subtotal)` },
              ]}
            />
          )}
          <s-text-field label="Title" name="title" value={values.title} details="Shown to customers at checkout." {...err("title")} />
          <s-number-field label="Priority" name="priority" value={values.priority} min={0} max={1000} step={1}
            details="Two enabled rules with the same priority can't overlap in dates." {...err("priority")} />
        </s-stack>
      </s-section>

      {ruleType === "BUNDLE" && (
        <s-section heading="Bundle">
          <BundleEditor
            rows={values.components}
            valueKind={values.bundleValueKind}
            value={values.bundleValue}
            limitPerOrder={values.limitPerOrder}
            currency={cur}
            titles={resourceTitles}
            onTitles={setBundleTitles}
            onRowsChange={setComponentCount}
            errors={errors}
            preview={preview[0] ?? null}
            cap={cap}
          />
        </s-section>
      )}

      {(ruleType === "AMOUNT_OFF_PRODUCTS" || ruleType === "BUY_X_GET_Y") && (
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
              Applies to carts with up to {cap} lines. Larger carts get no discount from this rule
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
              <Select
                label="Discount type"
                name="valueKind"
                value={valueKind}
                onChange={(v) => setValueKind(asKind(v))}
                error={errors.valueKind}
                options={[
                  { value: "PERCENTAGE", label: "Percentage" },
                  { value: "FIXED_AMOUNT", label: `Fixed amount (${cur})` },
                ]}
              />
              {valueKind === "PERCENTAGE" ? (
                <s-number-field label="Percentage off" name="percent" value={values.percent} min={0.01} max={100} step={0.01} suffix="%" {...err("percent")} />
              ) : (
                <>
                  <s-text-field label={`Amount off (${cur})`} name="amount" value={values.amount} placeholder="5.00"
                    details="In the store's currency; converted at checkout for other currencies." {...err("amount")} />
                  <Select
                    label="Applies"
                    name="appliesTo"
                    value={appliesTo}
                    onChange={(v) => setAppliesTo(v === "once" ? "once" : "each")}
                    error={errors.appliesTo}
                    options={[
                      { value: "each", label: "To each eligible item" },
                      { value: "once", label: "Once per order, split across eligible items" },
                    ]}
                  />
                </>
              )}
              <s-text color="subdued">
                Applies to carts with up to {cap} lines. Larger carts get no discount from this rule
                (Shopify Function instruction limit).
              </s-text>
            </s-stack>
          </s-section>
        </>
      ) : ruleType === "TIERED_SPEND" ? (
        <s-section heading="Tiers">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              The highest tier the cart subtotal reaches applies, to the whole order. Exactly at a threshold counts.
              No cart-size limit for this rule type.
            </s-paragraph>
            <Select
              label="Discount per tier"
              name="tierKind"
              value={tierKind}
              onChange={(v) => setTierKind(asKind(v))}
              options={[
                { value: "PERCENTAGE", label: "Percentage off the order" },
                { value: "FIXED_AMOUNT", label: `Fixed amount off the order (${cur})` },
              ]}
            />
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
      ) : ruleType === "FREE_SHIPPING" ? (
        <s-section heading="Free shipping">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              When the cart subtotal reaches the threshold (exactly at counts), a shipping discount applies to delivery
              options. No cart-line limit — this rule does not read cart lines.
            </s-paragraph>
            <s-text-field
              label={`Cart subtotal threshold (${cur})`}
              name="shipThreshold"
              value={values.shipThreshold}
              placeholder="100.00"
              details="In the store's currency; converted at checkout for other currencies."
              {...err("shipThreshold")}
            />
            <s-stack direction="inline" gap="base">
              <s-number-field
                label="Shipping discount"
                name="bogoPercent"
                value={values.bogoPercent}
                min={0.01}
                max={100}
                step={0.01}
                suffix="%"
                ref={bogoPercentRef}
                {...err("bogoPercent")}
              />
              <s-button variant="tertiary" onClick={makeFree}>
                Make it free
              </s-button>
            </s-stack>
            <s-text-field
              label={`Maximum discount per option (${cur}, optional)`}
              name="shipMaxAmount"
              value={values.shipMaxAmount}
              placeholder="Leave blank for no maximum"
              {...err("shipMaxAmount")}
            />
            <Select
              label="Apply to"
              name="shipAppliesTo"
              value={shipAppliesTo}
              onChange={(v) => setShipAppliesTo(v === "CHEAPEST" ? "CHEAPEST" : "ALL")}
              error={errors.shipAppliesTo}
              options={[
                { value: "ALL", label: "All delivery options" },
                { value: "CHEAPEST", label: "Cheapest option in each delivery group" },
              ]}
            />
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
      ) : null}

      <s-section heading="Active dates">
        <s-stack direction="block" gap="base">
          <s-date-field label="Start date" name="startDate" value={values.startDate} details={`Starts at 00:00 (${ctx.timezone}).`} {...err("startDate")} />
          <s-date-field label="End date (optional)" name="endDate" value={values.endDate} details={`Ends at 23:59 (${ctx.timezone}).`} {...err("endDate")} />
        </s-stack>
      </s-section>

      <s-section heading="Combinations">
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">This discount can be combined with:</s-text>
          <Checkbox label="Product discounts" name="combinesProduct" checked={values.combinesProduct} />
          <Checkbox label="Order discounts" name="combinesOrder" checked={values.combinesOrder} />
          {ruleType === "FREE_SHIPPING" ? (
            <s-text color="subdued">
              Shopify doesn&apos;t allow shipping discounts to combine with other shipping discounts.
            </s-text>
          ) : (
            <Checkbox label="Shipping discounts" name="combinesShipping" checked={values.combinesShipping} />
          )}
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
