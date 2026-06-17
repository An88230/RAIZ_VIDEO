export const jobStatuses = ["queued", "preparing", "rendering", "rendered", "failed", "cancelled"] as const;

export type LocalJobStatus = (typeof jobStatuses)[number];

const validTransitions: Record<LocalJobStatus, readonly LocalJobStatus[]> = {
  queued: ["preparing", "cancelled"],
  preparing: ["rendering", "failed", "cancelled"],
  rendering: ["rendered", "failed", "cancelled"],
  rendered: [],
  failed: [],
  cancelled: []
};

export class InvalidStatusTransitionError extends Error {
  constructor(from: LocalJobStatus, to: LocalJobStatus) {
    super(`Invalid job status transition: ${from} -> ${to}.`);
    this.name = "InvalidStatusTransitionError";
  }
}

export function isLocalJobStatus(value: unknown): value is LocalJobStatus {
  return typeof value === "string" && jobStatuses.includes(value as LocalJobStatus);
}

export function assertValidStatusTransition(from: LocalJobStatus, to: LocalJobStatus): void {
  if (!validTransitions[from].includes(to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
