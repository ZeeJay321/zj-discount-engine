import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { MAX_BUNDLE_COMPONENTS, MIN_BUNDLE_COMPONENTS } from "@zj/discount-core";
import { Select } from "./Select";

export interface ComponentRow {
  kind: "PRODUCT" | "VARIANT";
  /** Product GID (PRODUCT) or variant GID (VARIANT); "" until picked. */
  id: string;
  productId: string;
  quantity: string;
}

interface Props {
  rows: ComponentRow[];
  valueKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE";
  value: string;
  limitPerOrder: string;
  currency: string;
  /** GID → title, for already chosen components. */
  titles: Record<string, string>;
  /** Called when titles change (so the parent preview can name the components). */
  onTitles: (titles: Record<string, string>) => void;
  /** Called when rows are added/removed (so the parent re-validates). */
  onRowsChange: (count: number) => void;
  errors: Record<string, string>;
  preview: string | null;
  cap: number | null;
}

let rowSeq = 0;
const newKey = () => `component-${++rowSeq}`;

/**
 * Bundle components editor: 2–5 rows, each a product (any variant) or one specific
 * variant, picked with App Bridge's product picker, plus a quantity (1–10). Submits
 * parallel repeated fields: componentKind / componentId / componentProductId /
 * componentQuantity.
 */
export function BundleEditor({ rows: initialRows, valueKind: initialKind, value, limitPerOrder, currency, titles: initialTitles, onTitles, onRowsChange, errors, preview, cap }: Props) {
  const shopify = useAppBridge();
  const [rows, setRows] = useState(() => initialRows.map((r) => ({ ...r, key: newKey() })));
  const [titles, setTitles] = useState(initialTitles);
  const [valueKind, setValueKind] = useState(initialKind);

  function update(next: typeof rows) {
    setRows(next);
    onRowsChange(next.length);
  }

  async function pick(key: string) {
    const picked = await shopify.resourcePicker({ type: "product", multiple: false, filter: { variants: true } });
    const p = picked?.[0] as
      | { id: string; title?: string; variants?: Array<{ id?: string; title?: string }>; totalVariants?: number }
      | undefined;
    if (!p) return;
    const chosen = p.variants ?? [];
    const total = p.totalVariants ?? chosen.length;
    // One specific variant of a multi-variant product → a variant component; otherwise the whole product.
    const variant = chosen.length === 1 && total > 1 && chosen[0].id ? chosen[0] : null;
    const id = variant ? variant.id! : p.id;
    const title = variant ? `${p.title ?? p.id} — ${variant.title ?? variant.id}` : p.title ?? p.id;
    const nextTitles = { ...titles, [id]: title };
    setTitles(nextTitles);
    onTitles(nextTitles);
    update(rows.map((r) => (r.key === key ? { ...r, kind: variant ? "VARIANT" : "PRODUCT", id, productId: p.id } : r)));
  }

  const err = (k: string) => (errors[k] ? { error: errors[k] } : {});
  const valueLabel = valueKind === "PERCENTAGE" ? "Percentage off the bundle's units" : valueKind === "FIXED_AMOUNT" ? `Amount off each bundle (${currency})` : `Bundle price (${currency})`;

  return (
    <s-stack direction="block" gap="base">
      <s-paragraph>
        A complete bundle is every component at its quantity. Only units in complete bundles are discounted; within a
        component the cheapest units are used first.
      </s-paragraph>
      {rows.map((r, i) => (
        <s-stack key={r.key} direction="inline" gap="base">
          <input type="hidden" name="componentKind" value={r.kind} />
          <input type="hidden" name="componentId" value={r.id} />
          <input type="hidden" name="componentProductId" value={r.productId} />
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Component {i + 1}</s-text>
            <s-text {...(r.id ? {} : { color: "subdued" })}>{r.id ? titles[r.id] ?? r.id : "Nothing chosen yet"}</s-text>
            {errors[`componentItem.${i}`] && <s-text tone="critical">{errors[`componentItem.${i}`]}</s-text>}
            <s-button onClick={() => pick(r.key)}>{r.id ? "Change" : "Choose product or variant"}</s-button>
          </s-stack>
          <s-number-field label="Quantity" name="componentQuantity" value={r.quantity} min={1} max={10} step={1} {...err(`componentQuantity.${i}`)} />
          {rows.length > MIN_BUNDLE_COMPONENTS && (
            <s-button variant="tertiary" tone="critical" onClick={() => update(rows.filter((x) => x.key !== r.key))}>
              Remove
            </s-button>
          )}
        </s-stack>
      ))}
      {errors.components && <s-text tone="critical">{errors.components}</s-text>}
      {rows.length < MAX_BUNDLE_COMPONENTS && (
        <s-button onClick={() => update([...rows, { kind: "PRODUCT", id: "", productId: "", quantity: "1", key: newKey() }])}>Add component</s-button>
      )}
      <Select
        label="Discount"
        name="bundleValueKind"
        value={valueKind}
        onChange={(v) => setValueKind(v === "FIXED_AMOUNT" || v === "FIXED_PRICE" ? v : "PERCENTAGE")}
        options={[
          { value: "PERCENTAGE", label: "Percentage off the bundle" },
          { value: "FIXED_AMOUNT", label: `Fixed amount off each bundle (${currency})` },
          { value: "FIXED_PRICE", label: `Fixed bundle price (${currency})` },
        ]}
      />
      {valueKind === "PERCENTAGE" ? (
        <s-number-field label={valueLabel} name="bundleValue" value={value} min={0.01} max={100} step={0.01} suffix="%" {...err("bundleValue")} />
      ) : (
        <s-text-field label={valueLabel} name="bundleValue" value={value} placeholder="50.00" {...err("bundleValue")} />
      )}
      <s-number-field label="Limit per order" name="limitPerOrder" value={limitPerOrder} min={1} max={100} step={1} suffix="bundles"
        details="How many complete bundles can be discounted in one order (1–100)." {...err("limitPerOrder")} />
      {cap !== null && (
        <s-text color="subdued">
          Applies to carts with up to {cap} lines. Larger carts get no discount from this rule (Shopify Function
          instruction limit).
        </s-text>
      )}
      {preview && (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Preview</s-text>
            <s-text>{preview}</s-text>
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
}
