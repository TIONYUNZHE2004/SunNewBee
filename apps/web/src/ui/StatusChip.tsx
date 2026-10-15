import { STATUS, type StatusKey } from "./status";

export function StatusChip({ status, label }: { status: StatusKey; label?: string }) {
  const s = STATUS[status];
  return (
    <span className={`chip chip-${s.border} chip-${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span>
      {label ?? s.label}
    </span>
  );
}
