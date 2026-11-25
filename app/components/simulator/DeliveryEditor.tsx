import { TextField } from "./Field";
import type { SimCartState, SimDeliveryOption } from "./types";

let optSeq = 0;
const newOptId = () => `sim-opt-${++optSeq}`;

interface Props {
  state: SimCartState;
  onChange: (next: SimCartState) => void;
}

export function DeliveryEditor({ state, onChange }: Props) {
  function setOptions(deliveryOptions: SimDeliveryOption[]) {
    onChange({ ...state, deliveryOptions });
  }

  function update(id: string, patch: Partial<SimDeliveryOption>) {
    setOptions(state.deliveryOptions.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  return (
    <s-stack direction="block" gap="base">
      <s-paragraph>
        One delivery group with these options (enough for free-shipping rules). Costs are in the cart currency.
      </s-paragraph>
      {state.deliveryOptions.map((o) => (
        <s-stack key={o.id} direction="inline" gap="base">
          <TextField label="Handle" value={o.handle} onChange={(v) => update(o.id, { handle: v })} />
          <TextField label="Cost" value={o.cost} onChange={(v) => update(o.id, { cost: v })} />
          <s-button
            variant="tertiary"
            tone="critical"
            onClick={() => setOptions(state.deliveryOptions.filter((x) => x.id !== o.id))}
          >
            Remove
          </s-button>
        </s-stack>
      ))}
      <s-button
        onClick={() =>
          setOptions([
            ...state.deliveryOptions,
            { id: newOptId(), handle: `option-${state.deliveryOptions.length + 1}`, cost: "5.00" },
          ])
        }
      >
        Add delivery option
      </s-button>
    </s-stack>
  );
}
