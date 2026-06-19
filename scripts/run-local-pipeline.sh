#!/usr/bin/env bash
set -euo pipefail

API_URL="${RAIZ_API_URL:-http://127.0.0.1:4000}"
SAMPLE_JOB="${RAIZ_SAMPLE_JOB:-samples/valid-arabic-9x16-job.json}"
FALLBACK_JOB_ID="smoke-arabic-001"

if ! command -v curl >/dev/null 2>&1; then
  echo "[FAIL] curl is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] node is required."
  exit 1
fi

if [[ ! -f "$SAMPLE_JOB" ]]; then
  echo "[FAIL] Sample job not found: $SAMPLE_JOB"
  exit 1
fi

JOB_ID="$(
  node -e 'const fs = require("fs"); const path = process.argv[1]; const job = JSON.parse(fs.readFileSync(path, "utf8")); process.stdout.write(typeof job.job_id === "string" && job.job_id.trim() ? job.job_id : "");' "$SAMPLE_JOB" 2>/dev/null || true
)"

if [[ -z "$JOB_ID" ]]; then
  JOB_ID="$FALLBACK_JOB_ID"
fi

if [[ ! "$JOB_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "[FAIL] Unsafe job_id for local pipeline reset support: $JOB_ID"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
LAST_RESPONSE="$TMP_DIR/last-response.json"
trap 'rm -rf "$TMP_DIR"' EXIT

print_json_file() {
  local file_path="$1"

  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const raw = fs.readFileSync(path, "utf8");
    try {
      console.log(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      console.log(raw);
    }
  ' "$file_path"
}

json_field() {
  local file_path="$1"
  local field_path="$2"

  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const parts = process.argv[2].split(".");
    let value = data;
    for (const part of parts) {
      value = value == null ? undefined : value[part];
    }
    if (value !== undefined && value !== null) {
      process.stdout.write(String(value));
    }
  ' "$file_path" "$field_path"
}

require_last_field() {
  local label="$1"
  local field_path="$2"
  local expected_value="$3"
  local actual_value

  actual_value="$(json_field "$LAST_RESPONSE" "$field_path")"

  if [[ "$actual_value" != "$expected_value" ]]; then
    echo "[FAIL] $label"
    echo "       Expected $field_path to be $expected_value, got ${actual_value:-empty}."
    print_json_file "$LAST_RESPONSE"
    exit 1
  fi

  echo "[OK]   $label"
}

request() {
  local label="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local body_path="${5:-}"
  local response_path="$TMP_DIR/${label//[^a-zA-Z0-9_-]/_}.json"
  local status

  if [[ -n "$body_path" ]]; then
    if ! status="$(
      curl -sS \
        -o "$response_path" \
        -w "%{http_code}" \
        -X "$method" \
        -H "content-type: application/json" \
        --data-binary "@$body_path" \
        "$API_URL$path"
    )"; then
      echo "[FAIL] $label"
      echo "       Could not reach $API_URL$path"
      exit 1
    fi
  else
    if ! status="$(
      curl -sS \
        -o "$response_path" \
        -w "%{http_code}" \
        -X "$method" \
        "$API_URL$path"
    )"; then
      echo "[FAIL] $label"
      echo "       Could not reach $API_URL$path"
      exit 1
    fi
  fi

  if [[ "$status" != "$expected_status" ]]; then
    echo "[FAIL] $label"
    echo "       $method $path returned HTTP $status, expected $expected_status."
    print_json_file "$response_path"
    exit 1
  fi

  cp "$response_path" "$LAST_RESPONSE"
  echo "[OK]   $label"
}

echo "RAIZ local safe pipeline"
echo "API: $API_URL"
echo "Sample job: $SAMPLE_JOB"
echo "Job ID: $JOB_ID"
echo

request "system config" "GET" "/system/config" "200"

REAL_RENDER_ENABLED="$(json_field "$LAST_RESPONSE" "realRenderEnabled")"
STORAGE_DIR="$(json_field "$LAST_RESPONSE" "storageDir")"
STORAGE_DIR="${STORAGE_DIR:-storage/jobs}"
JOB_DIR="${STORAGE_DIR%/}/$JOB_ID"

if [[ "$REAL_RENDER_ENABLED" != "true" ]]; then
  echo "[FAIL] execution guard"
  echo "       The mocked HTTP sender endpoint is protected by RAIZ_ENABLE_REAL_RENDER=true."
  echo "       Restart the orchestrator with:"
  echo "       RAIZ_ENABLE_REAL_RENDER=true npm run dev --workspace @raiz/orchestrator"
  echo "       No short-video-maker process, Docker, upload, n8n workflow, or real render is started by this script."
  exit 1
fi

if [[ "${RAIZ_RESET_JOB:-false}" == "true" ]]; then
  if [[ -z "$STORAGE_DIR" || "$JOB_DIR" == "/" || "$JOB_DIR" == "." || "$JOB_DIR" == "$JOB_ID" ]]; then
    echo "[FAIL] Refusing to reset unsafe job directory: ${JOB_DIR:-empty}"
    exit 1
  fi

  echo "[WARN] RAIZ_RESET_JOB=true; deleting existing job folder before queue step:"
  echo "       $JOB_DIR"
  rm -rf -- "$JOB_DIR"
  echo "[OK]   reset job folder"
else
  echo "[OK]   reset disabled"
fi

request "queue job" "POST" "/jobs/render" "202" "$SAMPLE_JOB"
request "prepare render plan" "POST" "/jobs/$JOB_ID/prepare" "200"
request "preflight" "POST" "/jobs/$JOB_ID/preflight" "200"
require_last_field "preflight passed" "status" "passed"
request "adapter health" "POST" "/jobs/$JOB_ID/adapter-health" "200"
ADAPTER_HEALTH_STATUS="$(json_field "$LAST_RESPONSE" "status")"
if [[ "$ADAPTER_HEALTH_STATUS" == "missing" ]]; then
  echo "[FAIL] adapter health acceptable"
  echo "       Adapter health is missing. Check RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH on the running orchestrator."
  print_json_file "$LAST_RESPONSE"
  exit 1
fi
echo "[OK]   adapter health acceptable"
request "adapter payload" "POST" "/jobs/$JOB_ID/adapter-payload/short-video-maker" "200"
request "readiness review" "POST" "/jobs/$JOB_ID/readiness-review" "200"
require_last_field "readiness passed" "status" "passed"
require_last_field "ready for dry-run" "ready_for_dry_run" "true"
request "dry-run request" "POST" "/jobs/$JOB_ID/adapter-dry-run/short-video-maker" "200"
request "HTTP send plan" "POST" "/jobs/$JOB_ID/http-send-plan/short-video-maker" "200"
request "mocked HTTP send" "POST" "/jobs/$JOB_ID/http-send-mock/short-video-maker" "200"
request "real HTTP sender readiness" "POST" "/jobs/$JOB_ID/real-http-sender-readiness" "200"
require_last_field "real HTTP sender readiness passed" "status" "passed"
require_last_field "ready for real HTTP sender" "ready_for_real_http_sender" "true"
request "artifact inventory" "GET" "/jobs/$JOB_ID/artifacts" "200"

ARTIFACT_COUNT="$(json_field "$LAST_RESPONSE" "summary.total_artifacts")"

echo
echo "[OK]   Pipeline completed."
echo "       Artifacts detected: ${ARTIFACT_COUNT:-unknown}"
echo "       Final job folder: $JOB_DIR/"
echo "       No short-video-maker process, Docker, upload, n8n workflow, or video generation was started by this script."
