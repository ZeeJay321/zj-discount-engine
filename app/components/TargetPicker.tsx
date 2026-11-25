import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export type TargetKind = "COLLECTIONS" | "PRODUCTS";

interface Props {
  kind: TargetKind;
  ids: string[];
  /** id → title for already chosen resources (from the loader). */
  titles: Record<string, string>;
  error?: string;
}

/**
 * The product set of a product rule (amount off, buy X get Y): whole collections or a
 * product list, picked with App Bridge's resource picker. Submits hidden `targetKind`
 * and repeated `targetIds` fields.
 */
export function TargetPicker({ kind: initialKind, ids, titles, error }: Props) {
  const shopify = useAppBridge();
  const [kind, setKind] = useState<TargetKind>(initialKind);
  const [items, setItems] = useState(ids.map((id) => ({ id, title: titles[id] ?? id })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kindRef = useRef<any>(null);

  // React 18 doesn't wire custom-element events from props; listen directly.
  useEffect(() => {
    const el = kindRef.current;
    if (!el) return;
    const onChange = () => {
      const next: TargetKind = el.value === "PRODUCTS" ? "PRODUCTS" : "COLLECTIONS";
      setKind((prev) => {
        if (prev !== next) setItems([]); // a different kind of set: start over
        return next;
      });
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  async function pick() {
    const picked = await shopify.resourcePicker({
      type: kind === "PRODUCTS" ? "product" : "collection",
      multiple: true,
      selectionIds: items.map((i) => ({ id: i.id })),
    });
    if (picked) setItems(picked.map((p: { id: string; title?: string }) => ({ id: p.id, title: p.title ?? p.id })));
  }

  const noun = kind === "PRODUCTS" ? "products" : "collections";
  return (
    <s-stack direction="block" gap="base">
      <input type="hidden" name="targetKind" value={kind} />
      {items.map((i) => (
        <input key={i.id} type="hidden" name="targetIds" value={i.id} />
      ))}
      <s-select label="Applies to" value={kind} ref={kindRef}>
        <s-option value="COLLECTIONS">Products in collections</s-option>
        <s-option value="PRODUCTS">Specific products</s-option>
      </s-select>
      {items.length === 0 ? (
        <s-text color="subdued">No {noun} chosen.</s-text>
      ) : (
        <s-unordered-list>
          {items.map((i) => (
            <s-list-item key={i.id}>{i.title}</s-list-item>
          ))}
        </s-unordered-list>
      )}
      {error && <s-text tone="critical">{error}</s-text>}
      <s-button onClick={pick}>{items.length ? `Change ${noun}` : `Choose ${noun}`}</s-button>
    </s-stack>
  );
}
