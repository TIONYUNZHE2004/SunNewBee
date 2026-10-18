import type { ComponentProps, ReactNode } from "react";

// ComponentProps<"button"> includes `ref` (React 19 passes it through as a prop).
type Props = ComponentProps<"button"> & {
  variant?: "primary" | "outline";
  icon?: ReactNode;
};

export function Button({ variant = "primary", icon, className = "", children, ...rest }: Props) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const v =
    variant === "primary"
      ? "bg-accent text-on-accent shadow-sm hover:opacity-90"
      : "border border-edge bg-surface text-fg hover:bg-fg/5";
  return (
    <button type="button" className={`${base} ${v} ${className}`} {...rest}>
      {children}
      {icon}
    </button>
  );
}
