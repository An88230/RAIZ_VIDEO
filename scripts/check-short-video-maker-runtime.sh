#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [[ -f ".env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    if [[ -z "$line" || "$line" == \#* || "$line" != *=* ]]; then
      continue
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%%[[:space:]]#*}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done < ".env"
fi

BASE_URL="${RAIZ_SHORT_VIDEO_MAKER_BASE_URL:-http://localhost:3123}"
HEALTH_PATH="${RAIZ_SHORT_VIDEO_MAKER_HEALTH_PATH:-/health}"
TIMEOUT_SECONDS="${RAIZ_SHORT_VIDEO_MAKER_HEALTH_TIMEOUT_SECONDS:-5}"

if [[ "$HEALTH_PATH" != /* ]]; then
  echo "[FAIL] RAIZ_SHORT_VIDEO_MAKER_HEALTH_PATH must start with /"
  exit 1
fi

if ! [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "[FAIL] RAIZ_SHORT_VIDEO_MAKER_HEALTH_TIMEOUT_SECONDS must be a positive integer"
  exit 1
fi

HEALTH_URL="${BASE_URL%/}$HEALTH_PATH"
TMP_RESPONSE="$(mktemp)"
trap 'rm -f "$TMP_RESPONSE"' EXIT

echo "short-video-maker runtime check"
echo "Health URL: $HEALTH_URL"
echo "Safety: health check only; no render request, no Docker, no process start."

if ! STATUS_CODE="$(curl -sS --max-time "$TIMEOUT_SECONDS" -o "$TMP_RESPONSE" -w "%{http_code}" "$HEALTH_URL")"; then
  echo "[FAIL] Could not reach short-video-maker health endpoint."
  exit 1
fi

if [[ "$STATUS_CODE" != "200" ]]; then
  echo "[FAIL] Health endpoint returned HTTP $STATUS_CODE"
  cat "$TMP_RESPONSE"
  exit 1
fi

echo "[OK] short-video-maker health endpoint returned 200"
cat "$TMP_RESPONSE"
