import type { ComponentProps, ReactNode } from "react";

// ComponentProps<"button"> includes `ref` (React 19 passes it through as a prop).
type Props = ComponentProps<"button"> & {
  variant?: "primary" | "outline";
  icon?: ReactNode;
};

export function Button({ variant = "primary", icon, className = "", children, ...rest }: Props) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50";
  const v =
    variant === "primary"
      ? "bg-accent text-on-accent shadow-md hover:brightness-105"
      : "border border-fg/70 bg-transparent text-fg hover:bg-fg/10";
  return (
    <button type="button" className={`${base} ${v} ${className}`} {...rest}>
      {children}
      {icon}
    </button>
  );
}
