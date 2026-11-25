import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  /** Form field name. Omit for controlled UI-only checkboxes (pass `onChange`). */
  name?: string;
  checked: boolean;
  details?: string;
  error?: string;
  onChange?: (checked: boolean) => void;
}

/**
 * Polaris `<s-checkbox>` that shows the saved value and submits correctly in React 18.
 *
 * React 18 only sets the `checked` attribute on custom elements; FormData reads the
 * property. A plain `<s-checkbox checked>` therefore looks wrong after load and often
 * submits as unchecked. This wrapper keeps the property in sync and writes a hidden
 * input so FormData always sees "on" when checked, regardless of the custom element.
 */
export function Checkbox({ label, name, checked: initial, details, error, onChange }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [el, setEl] = useState<any>(null);
  const [on, setOn] = useState(initial);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setOn(initial), [initial]);

  useEffect(() => {
    if (el && el.checked !== on) el.checked = on;
    if (hiddenRef.current) hiddenRef.current.disabled = !on;
  }, [el, on]);

  useEffect(() => {
    if (!el) return;
    const handler = () => {
      const next = !!el.checked;
      setOn(next);
      if (hiddenRef.current) hiddenRef.current.disabled = !next;
      onChangeRef.current?.(next);
    };
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [el]);

  return (
    <>
      {name ? <input ref={hiddenRef} type="hidden" name={name} value="on" disabled={!on} /> : null}
      <s-checkbox
        ref={setEl}
        label={label}
        {...(on ? { checked: true } : {})}
        {...(details ? { details } : {})}
        {...(error ? { error } : {})}
      />
    </>
  );
}
