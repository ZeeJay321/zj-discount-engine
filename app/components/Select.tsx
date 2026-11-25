import { useEffect, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  /** Form field name (omit for a UI-only select). */
  name?: string;
  value: T;
  options: SelectOption<T>[];
  onChange?: (value: T) => void;
  error?: string;
  details?: string;
}

/**
 * Polaris `<s-select>` that reliably shows `value` and reports changes in React 18.
 *
 * - React 18 only sets the `value` *attribute* on custom elements, which the Polaris
 *   select doesn't read when it first appears, so it showed its first option (e.g.
 *   "Percentage" for a rule saved as a fixed amount) and choosing that option fired no
 *   change. Here the value is also set as a property, and the matching option is marked
 *   `selected`.
 * - Change listeners are attached whenever the element appears (state ref), so selects
 *   rendered later (after switching rule type) work too.
 */
export function Select<T extends string>({ label, name, value, options, onChange, error, details }: Props<T>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [el, setEl] = useState<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!el) return;
    const handler = () => onChangeRef.current?.(String(el.value) as T);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [el]);

  useEffect(() => {
    if (el && el.value !== value) el.value = value;
  }, [el, value]);

  return (
    <s-select
      ref={setEl}
      label={label}
      value={value}
      {...(name ? { name } : {})}
      {...(error ? { error } : {})}
      {...(details ? { details } : {})}
    >
      {options.map((o) => (
        <s-option key={o.value} value={o.value} {...(o.value === value ? { selected: true } : {})}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}
