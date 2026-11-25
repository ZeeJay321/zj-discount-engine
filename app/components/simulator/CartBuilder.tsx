import { useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Select } from "../Select";
import { NumberField, TextField } from "./Field";
import type { SimCartState, SimLine } from "./types";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "KWD"] as const;

let lineSeq = 0;
const newLineId = () => `sim-line-${++lineSeq}-${Date.now()}`;

interface Props {
  state: SimCartState;
  shopCurrency: string;
  onChange: (next: SimCartState) => void;
}

export function CartBuilder({ state, shopCurrency, onChange }: Props) {
  const shopify = useAppBridge();
  const fileRef = useRef<HTMLInputElement>(null);
  const currencies = CURRENCIES.includes(shopCurrency as (typeof CURRENCIES)[number])
    ? [...CURRENCIES]
    : [shopCurrency, ...CURRENCIES];

  function set(partial: Partial<SimCartState>) {
    onChange({ ...state, ...partial });
  }

  function updateLine(id: string, patch: Partial<SimLine>) {
    set({ lines: state.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  function removeLine(id: string) {
    set({ lines: state.lines.filter((l) => l.id !== id) });
  }

  async function addFromPicker() {
    const picked = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      filter: { variants: true },
    });
    if (!picked?.length) return;
    const next: SimLine[] = [...state.lines];
    for (const p of picked as Array<{
      id: string;
      title?: string;
      variants?: Array<{ id?: string; title?: string; price?: string }>;
    }>) {
      const variants = p.variants?.length ? p.variants : [{ id: undefined, title: undefined, price: "10.00" }];
      for (const v of variants) {
        next.push({
          id: newLineId(),
          title: v.title && v.title !== "Default Title" ? `${p.title ?? "Product"} — ${v.title}` : p.title ?? p.id,
          quantity: 1,
          unitPrice: v.price ?? "10.00",
          productId: p.id,
          variantId: v.id ?? "",
          collectionIds: [],
          collectionTitles: {},
        });
      }
    }
    set({ lines: next });
  }

  function addManual() {
    set({
      lines: [
        ...state.lines,
        {
          id: newLineId(),
          title: "Manual line",
          quantity: 1,
          unitPrice: "10.00",
          productId: "",
          variantId: "",
          collectionIds: [],
          collectionTitles: {},
        },
      ],
    });
  }

  async function pickCollections(lineId: string) {
    const line = state.lines.find((l) => l.id === lineId);
    if (!line) return;
    const picked = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: line.collectionIds.map((id) => ({ id })),
    });
    if (!picked) return;
    const collectionIds = picked.map((c: { id: string }) => c.id);
    const collectionTitles: Record<string, string> = {};
    for (const c of picked as Array<{ id: string; title?: string }>) {
      collectionTitles[c.id] = c.title ?? c.id;
    }
    updateLine(lineId, { collectionIds, collectionTitles });
  }

  function loadExample() {
    set({
      currencyCode: shopCurrency,
      presentmentCurrencyRate: "1",
      lines: [
        {
          id: newLineId(),
          title: "Example sweater",
          quantity: 2,
          unitPrice: "40.00",
          productId: "gid://shopify/Product/sim-1",
          variantId: "gid://shopify/ProductVariant/sim-1",
          collectionIds: ["gid://shopify/Collection/sim-winter"],
          collectionTitles: { "gid://shopify/Collection/sim-winter": "Winter" },
        },
        {
          id: newLineId(),
          title: "Example mug",
          quantity: 1,
          unitPrice: "12.00",
          productId: "gid://shopify/Product/sim-2",
          variantId: "gid://shopify/ProductVariant/sim-2",
          collectionIds: [],
          collectionTitles: {},
        },
      ],
      deliveryOptions: [
        { id: "d1", handle: "standard", cost: "5.00" },
        { id: "d2", handle: "express", cost: "15.00" },
      ],
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulator-cart.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SimCartState;
        if (!parsed || !Array.isArray(parsed.lines)) throw new Error("bad shape");
        onChange({
          currencyCode: parsed.currencyCode || shopCurrency,
          presentmentCurrencyRate: parsed.presentmentCurrencyRate || "1",
          lines: parsed.lines,
          deliveryOptions: Array.isArray(parsed.deliveryOptions) ? parsed.deliveryOptions : [],
        });
      } catch {
        shopify.toast.show("Could not read that JSON cart.");
      }
    };
    reader.readAsText(file);
  }

  const showRate = state.currencyCode.toUpperCase() !== shopCurrency.toUpperCase();

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base">
        <Select
          label="Cart currency"
          value={state.currencyCode}
          onChange={(v) => set({ currencyCode: v })}
          options={currencies.map((c) => ({ value: c, label: c }))}
        />
        {showRate && (
          <TextField
            label="Presentment rate (shop → cart)"
            value={state.presentmentCurrencyRate}
            onChange={(v) => set({ presentmentCurrencyRate: v })}
            details="Shopify presentmentCurrencyRate"
          />
        )}
      </s-stack>

      <s-stack direction="inline" gap="small-200">
        <s-button onClick={addFromPicker}>Add product</s-button>
        <s-button onClick={addManual}>Add manual line</s-button>
        <s-button variant="tertiary" onClick={loadExample}>
          Load example cart
        </s-button>
        <s-button variant="tertiary" onClick={exportJson}>
          Export JSON
        </s-button>
        <s-button variant="tertiary" onClick={() => fileRef.current?.click()}>
          Import JSON
        </s-button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </s-stack>

      {state.lines.length === 0 ? (
        <s-text color="subdued">No lines yet. Add a product or load the example cart.</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          {state.lines.map((l) => (
            <s-box key={l.id} padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <TextField label="Title" value={l.title} onChange={(v) => updateLine(l.id, { title: v })} />
                <s-stack direction="inline" gap="base">
                  <NumberField
                    label="Qty"
                    value={l.quantity}
                    min={1}
                    step={1}
                    onChange={(n) => updateLine(l.id, { quantity: Math.max(1, n) })}
                  />
                  <TextField
                    label={`Unit price (${state.currencyCode})`}
                    value={l.unitPrice}
                    onChange={(v) => updateLine(l.id, { unitPrice: v })}
                  />
                </s-stack>
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="tertiary" onClick={() => pickCollections(l.id)}>
                    Collections ({l.collectionIds.length})
                  </s-button>
                  <s-button variant="tertiary" tone="critical" onClick={() => removeLine(l.id)}>
                    Remove
                  </s-button>
                </s-stack>
                {l.collectionIds.length > 0 && (
                  <s-text color="subdued">
                    {l.collectionIds.map((id) => l.collectionTitles[id] ?? id).join(", ")}
                  </s-text>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      )}
    </s-stack>
  );
}
