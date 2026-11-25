import { useEffect, useRef, useState } from "react";

/** Controlled Polaris text/number field (React 18 + custom elements). */
export function TextField({
  label,
  value,
  onChange,
  details,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  details?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [el, setEl] = useState<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!el) return;
    const handler = () => onChangeRef.current?.(String(el.value ?? ""));
    el.addEventListener("change", handler);
    el.addEventListener("input", handler);
    return () => {
      el.removeEventListener("change", handler);
      el.removeEventListener("input", handler);
    };
  }, [el]);

  useEffect(() => {
    if (el && String(el.value ?? "") !== value) el.value = value;
  }, [el, value]);

  return (
    <s-text-field
      ref={setEl}
      label={label}
      value={value}
      {...(details ? { details } : {})}
    />
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [el, setEl] = useState<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!el) return;
    const handler = () => {
      const n = Math.floor(Number(el.value));
      onChangeRef.current?.(Number.isFinite(n) ? n : min ?? 1);
    };
    el.addEventListener("change", handler);
    el.addEventListener("input", handler);
    return () => {
      el.removeEventListener("change", handler);
      el.removeEventListener("input", handler);
    };
  }, [el, min]);

  useEffect(() => {
    if (el && String(el.value) !== String(value)) el.value = String(value);
  }, [el, value]);

  return (
    <s-number-field
      ref={setEl}
      label={label}
      value={String(value)}
      {...(min !== undefined ? { min } : {})}
      {...(step !== undefined ? { step } : {})}
    />
  );
}
