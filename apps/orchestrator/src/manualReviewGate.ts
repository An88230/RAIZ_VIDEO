import { writeFile } from "node:fs/promises";

import {
  appendJobEvent,
  getJobPaths,
  getJobStatus,
  type PersistenceOptions,
  updateJobMetadata
} from "./persistence.js";

export interface ManualReviewApproval {
  job_id: string;
  status: "approved";
  reviewer_note: string | null;
  review_package_path: string;
  approved_at: string;
}

export interface ManualReviewRejection {
  job_id: string;
  status: "rejected";
  reviewer_note: string | null;
  review_package_path: string;
  rejected_at: string;
}

export class JobManualReviewStateError extends Error {
  constructor(jobId: string, status: string) {
    super(`Job ${jobId} must be rendered before manual review. Current status is ${status}.`);
    this.name = "JobManualReviewStateError";
  }
}

export class JobManualReviewPackageError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} must have a review package before manual review.`);
    this.name = "JobManualReviewPackageError";
  }
}

export async function approveOutputForPublish(
  jobId: string,
  reviewerNote?: string,
  options: PersistenceOptions = {}
): Promise<ManualReviewApproval> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);
  assertReadyForManualReview(jobId, status.status, status.metadata);

  const approval: ManualReviewApproval = {
    job_id: jobId,
    status: "approved",
    reviewer_note: normalizeReviewerNote(reviewerNote),
    review_package_path: String(status.metadata?.review_package_path ?? paths.reviewPackagePath),
    approved_at: new Date().toISOString()
  };

  await writeFile(paths.manualReviewApprovalPath, `${JSON.stringify(approval, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      manual_review_approved: true,
      manual_review_approval_path: paths.manualReviewApprovalPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.manual_review_approved",
      manual_review_approval_path: paths.manualReviewApprovalPath
    },
    options
  );

  return approval;
}

export async function rejectOutputForPublish(
  jobId: string,
  reviewerNote?: string,
  options: PersistenceOptions = {}
): Promise<ManualReviewRejection> {
  const paths = getJobPaths(jobId, options);
  const status = await getJobStatus(jobId, options);
  assertReadyForManualReview(jobId, status.status, status.metadata);

  const rejection: ManualReviewRejection = {
    job_id: jobId,
    status: "rejected",
    reviewer_note: normalizeReviewerNote(reviewerNote),
    review_package_path: String(status.metadata?.review_package_path ?? paths.reviewPackagePath),
    rejected_at: new Date().toISOString()
  };

  await writeFile(paths.manualReviewRejectionPath, `${JSON.stringify(rejection, null, 2)}\n`);
  await updateJobMetadata(
    jobId,
    {
      manual_review_approved: false,
      manual_review_rejection_path: paths.manualReviewRejectionPath
    },
    options
  );
  await appendJobEvent(
    jobId,
    {
      type: "job.manual_review_rejected",
      manual_review_rejection_path: paths.manualReviewRejectionPath
    },
    options
  );

  return rejection;
}

function assertReadyForManualReview(
  jobId: string,
  status: string,
  metadata: Record<string, unknown> | undefined
): void {
  if (status !== "rendered") {
    throw new JobManualReviewStateError(jobId, status);
  }

  if (metadata?.review_package_created !== true) {
    throw new JobManualReviewPackageError(jobId);
  }
}

function normalizeReviewerNote(reviewerNote: string | undefined): string | null {
  if (typeof reviewerNote !== "string") {
    return null;
  }

  const trimmedNote = reviewerNote.trim();
  return trimmedNote.length > 0 ? trimmedNote : null;
}
