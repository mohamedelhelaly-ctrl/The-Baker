import { useState } from "react";
import { MAX_QTY } from "../../lib/cartKeys";
import { TextField } from "../ui/TextField";

interface Props {
  label: string;
  hideLabel?: boolean;
  value: number;
  onCommit: (quantity: number) => void;
}

/**
 * A number box that can be emptied and retyped. While focused it shows what the customer is typing;
 * valid numbers are committed straight away, and on blur it snaps back to the real quantity.
 */
export function QuantityField({ label, hideLabel, value, onCommit }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  return (
    <TextField
      label={label}
      hideLabel={hideLabel}
      type="number"
      min={1}
      max={MAX_QTY}
      inputMode="numeric"
      value={editing ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n) && n >= 1) onCommit(Math.min(MAX_QTY, Math.floor(n)));
      }}
    />
  );
}
