import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { MAX_CART_LINES, validateRule, type OtherRule } from "@zj/discount-core";
import { errorsByFormField, parseRuleForm, type FormContext } from "../lib/rule-form";

export interface RuleFormValues {
  id: string;
  title: string;
  priority: string;
  valueKind: "PERCENTAGE" | "FIXED_AMOUNT";
  percent: string;
  amount: string;
  appliesTo: "each" | "once";
  startDate: string;
  endDate: string;
  collectionIds: string[];
  combinesOrder: boolean;
  combinesProduct: boolean;
  combinesShipping: boolean;
}

interface Props {
  values: RuleFormValues;
  collectionTitles: Record<string, string>;
  /** Other rules of the shop, for the same-priority overlap check before submit. */
  others: OtherRule[];
  ctx: FormContext;
  /** Errors returned by the server action, keyed by form field. */
  serverErrors?: Record<string, string>;
  submitting: boolean;
  submitLabel: string;
}

const checked = (on: boolean) => (on ? { checked: true } : {});

export function RuleForm({ values, collectionTitles, others, ctx, serverErrors, submitting, submitLabel }: Props) {
  const shopify = useAppBridge();
  const [errors, setErrors] = useState<Record<string, string>>(serverErrors ?? {});
  const [valueKind, setValueKind] = useState(values.valueKind);
  const [collections, setCollections] = useState(
    values.collectionIds.map((id) => ({ id, title: collectionTitles[id] ?? id })),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kindRef = useRef<any>(null);

  useEffect(() => setErrors(serverErrors ?? {}), [serverErrors]);

  // React 18 doesn't wire custom-element events from props; listen directly.
  useEffect(() => {
    const el = kindRef.current;
    if (!el) return;
    const onChange = () => setValueKind((el as { value: string }).value === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE");
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  async function pickCollections() {
    const picked = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: collections.map((c) => ({ id: c.id })),
    });
    if (picked) setCollections(picked.map((c: { id: string; title?: string }) => ({ id: c.id, title: c.title ?? c.id })));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const { draft, errors: parseErrors } = parseRuleForm(new FormData(event.currentTarget), ctx);
    const all = [...parseErrors, ...validateRule(draft, others)];
    if (all.length > 0) {
      event.preventDefault();
      setErrors(errorsByFormField(all));
    } else {
      setErrors({});
    }
  }

  const err = (k: string) => (errors[k] ? { error: errors[k] } : {});

  return (
    <Form method="post" onSubmit={onSubmit}>
      <input type="hidden" name="intent" value="save" />
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {collections.map((c) => (
        <input key={c.id} type="hidden" name="collectionIds" value={c.id} />
      ))}

      {errors.form && (
        <s-banner tone="critical" heading="The rule couldn't be saved">
          <s-paragraph>{errors.form}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Rule">
        <s-stack direction="block" gap="base">
          <s-text-field label="Title" name="title" value={values.title} details="Shown to customers at checkout." {...err("title")} />
          <s-number-field label="Priority" name="priority" value={values.priority} min={0} max={1000} step={1}
            details="Two enabled rules with the same priority can't overlap in dates." {...err("priority")} />
        </s-stack>
      </s-section>

      <s-section heading="Collections">
        <s-stack direction="block" gap="base">
          {collections.length === 0 ? (
            <s-text color="subdued">No collections chosen.</s-text>
          ) : (
            <s-unordered-list>
              {collections.map((c) => (
                <s-list-item key={c.id}>{c.title}</s-list-item>
              ))}
            </s-unordered-list>
          )}
          {errors.collectionIds && <s-text tone="critical">{errors.collectionIds}</s-text>}
          <s-button onClick={pickCollections}>{collections.length ? "Change collections" : "Choose collections"}</s-button>
        </s-stack>
      </s-section>

      <s-section heading="Value">
        <s-stack direction="block" gap="base">
          <s-select label="Discount type" name="valueKind" value={valueKind} ref={kindRef} {...err("valueKind")}>
            <s-option value="PERCENTAGE">Percentage</s-option>
            <s-option value="FIXED_AMOUNT">Fixed amount ({ctx.shopCurrency})</s-option>
          </s-select>
          {valueKind === "PERCENTAGE" ? (
            <s-number-field label="Percentage off" name="percent" value={values.percent} min={0.01} max={100} step={0.01} suffix="%" {...err("percent")} />
          ) : (
            <>
              <s-text-field label={`Amount off (${ctx.shopCurrency})`} name="amount" value={values.amount} placeholder="5.00"
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
        <s-button href="/app">Cancel</s-button>
      </s-stack>
    </Form>
  );
}
