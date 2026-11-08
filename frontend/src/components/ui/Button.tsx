import type { ButtonHTMLAttributes } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-md bg-primary px-5 py-2 font-semibold text-primary-ink hover:bg-primary-hover disabled:opacity-60 ${className}`}
    />
  );
}
