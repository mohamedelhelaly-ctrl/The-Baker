import type { ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonVariant } from "./buttonClass";

/** One primary action per area; use `secondary` for the next most important and `quiet` for the rest. */
export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}
