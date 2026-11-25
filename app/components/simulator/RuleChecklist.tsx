import { Checkbox } from "../Checkbox";
import { TextField } from "./Field";
import type { SimRuleRow } from "./types";

interface Props {
  rules: SimRuleRow[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  nowDay: string;
  onNowDay: (day: string) => void;
  timezone: string;
}

export function RuleChecklist({ rules, selected, onChange, nowDay, onNowDay, timezone }: Props) {
  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  }

  return (
    <s-stack direction="block" gap="base">
      <TextField
        label={`Simulate as of (shop day, ${timezone})`}
        value={nowDay}
        onChange={onNowDay}
        details="Uses noon on that calendar day in the shop timezone."
      />
      <s-stack direction="inline" gap="small-200">
        <s-button
          variant="tertiary"
          onClick={() => onChange(new Set(rules.filter((r) => r.enabled).map((r) => r.ruleId)))}
        >
          Enabled only
        </s-button>
        <s-button variant="tertiary" onClick={() => onChange(new Set(rules.map((r) => r.ruleId)))}>
          All
        </s-button>
        <s-button variant="tertiary" onClick={() => onChange(new Set())}>
          None
        </s-button>
      </s-stack>
      {rules.length === 0 ? (
        <s-text color="subdued">No rules in this shop yet.</s-text>
      ) : (
        <s-stack direction="block" gap="small-200">
          {rules.map((r) => (
            <Checkbox
              key={r.ruleId}
              label={`${r.title} · ${r.typeLabel}${r.enabled ? "" : " (disabled)"}`}
              checked={selected.has(r.ruleId)}
              onChange={(on) => toggle(r.ruleId, on)}
              details={`Priority ${r.priority}`}
            />
          ))}
        </s-stack>
      )}
    </s-stack>
  );
}
