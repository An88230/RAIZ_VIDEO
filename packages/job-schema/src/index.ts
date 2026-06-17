import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RaizJob } from "./types.js";

export type {
  RaizCaptionFormat,
  RaizCaptionPosition,
  RaizJob,
  RaizPlatform,
  RaizPublishMode,
  RaizTemplateEngine,
  RaizVoiceType
} from "./types.js";

export interface RaizJobValidationIssue {
  path: string;
  message: string;
  keyword: string;
}

export type RaizJobValidationResult =
  | { valid: true; job: RaizJob }
  | { valid: false; errors: RaizJobValidationIssue[] };

export class RaizJobValidationError extends Error {
  readonly issues: RaizJobValidationIssue[];

  constructor(issues: RaizJobValidationIssue[]) {
    super("Invalid RAIZ job payload.");
    this.name = "RaizJobValidationError";
    this.issues = issues;
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url));
export const raizJobSchemaPath = resolve(currentDir, "../../../raiz-job.schema.json");
export const raizJobSchema = JSON.parse(readFileSync(raizJobSchemaPath, "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile<RaizJob>(raizJobSchema);

export function validateRaizJob(payload: unknown): RaizJobValidationResult {
  if (validate(payload)) {
    return { valid: true, job: payload as RaizJob };
  }

  return {
    valid: false,
    errors: formatValidationErrors(validate.errors ?? [])
  };
}

export function assertValidRaizJob(payload: unknown): asserts payload is RaizJob {
  const result = validateRaizJob(payload);

  if (!result.valid) {
    throw new RaizJobValidationError(result.errors);
  }
}

function formatValidationErrors(errors: ErrorObject[]): RaizJobValidationIssue[] {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "Schema validation failed.",
    keyword: error.keyword
  }));
}
