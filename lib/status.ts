import { APP_STATUS, APP_STATUSES, type AppStatus } from "@/types/domain";

const ACCENTED_DONE = "Conclu\u00edda";

export function normalizeStatus(value?: string | null): AppStatus {
  const status = APP_STATUSES.find(
    (item) =>
      item.localeCompare(value ?? "", "pt-BR", { sensitivity: "base" }) === 0 ||
      (item === APP_STATUS.done && value === ACCENTED_DONE),
  );

  return status ?? APP_STATUS.pending;
}

export function statusClass(status: string): "pending" | "doing" | "done" {
  const normalized = normalizeStatus(status);
  if (normalized === APP_STATUS.done) return "done";
  if (normalized === APP_STATUS.inProgress) return "doing";
  return "pending";
}
