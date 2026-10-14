import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { createVrError, createVrMessage, onCreated } from "./createVr";
import { createVR } from "./manageApi";
import { useStaffToken } from "./useStaffToken";

export type CreateVrStatus = "idle" | "pending" | "done" | "error";

export function CreateVrButtonView({
  label,
  status,
  message,
  noToken,
  onClick,
}: {
  label: string;
  status: CreateVrStatus;
  message?: string;
  noToken?: boolean;
  onClick: () => void;
}) {
  const hintId = useId();
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={status === "pending" || noToken}
        aria-describedby={noToken ? hintId : undefined}
        className="min-h-11 rounded-md border border-brand px-3 text-sm text-brand hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "pending" ? "Filing…" : "Create verification request"}
        <span className="sr-only"> for {label}</span>
      </button>
      {noToken && (
        <p id={hintId} className="text-xs text-ink-soft">
          Enter the staff token to file requests.
        </p>
      )}
      {status === "done" && (
        <p role="status" className="text-xs font-medium">
          {message}
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="text-xs font-medium text-danger">
          {message}
        </p>
      )}
    </div>
  );
}

export function CreateVrButton({ elementId, attribute }: { elementId: string; attribute: string }) {
  const [token] = useStaffToken();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => createVR({ target_id: elementId, attribute, reason: "unknown" }, token),
    onSuccess: () => onCreated(qc),
  });
  const status: CreateVrStatus = m.isPending
    ? "pending"
    : m.isSuccess
      ? "done"
      : m.isError
        ? "error"
        : "idle";
  return (
    <CreateVrButtonView
      label={`${elementId} ${attribute}`}
      status={status}
      noToken={!token}
      message={
        m.isSuccess ? createVrMessage(m.data) : m.isError ? createVrError(m.error) : undefined
      }
      onClick={() => m.mutate()}
    />
  );
}
