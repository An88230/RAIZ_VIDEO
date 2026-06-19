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
  echo "[OK] loaded .env"
else
  echo "[OK] .env not found; using safe defaults"
fi

export PORT="${PORT:-4000}"
export HOST="${HOST:-0.0.0.0}"
export RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH="${RAIZ_SHORT_VIDEO_MAKER_VENDOR_PATH:-$REPO_ROOT/vendor/short-video-maker}"
export RAIZ_STORAGE_DIR="${RAIZ_STORAGE_DIR:-$REPO_ROOT/storage/jobs}"

BASE_URL="http://127.0.0.1:$PORT"

echo "RAIZ orchestrator"
echo "Port: $PORT"
echo "Host: $HOST"
echo
echo "Health URLs:"
echo "  $BASE_URL/system/config"
echo "  $BASE_URL/system/execution-guard"
echo "  $BASE_URL/adapters/short-video-maker/health"
echo
echo "Local safe pipeline:"
echo "  RAIZ_API_URL=$BASE_URL ./scripts/run-local-pipeline.sh"
echo
echo "short-video-maker connection commands:"
echo "  ./scripts/discover-short-video-maker.sh"
echo "  RAIZ_SHORT_VIDEO_MAKER_BASE_URL=${RAIZ_SHORT_VIDEO_MAKER_BASE_URL:-http://127.0.0.1:3123}"
echo "  curl $BASE_URL/adapters/short-video-maker/health"
echo "  # If short-video-maker is started separately in a future/manual step:"
echo "  # curl ${RAIZ_SHORT_VIDEO_MAKER_BASE_URL:-http://127.0.0.1:3123}/health"
echo
echo "Safety:"
echo "  This starts RAIZ only."
echo "  It does not start vendor/short-video-maker."
echo "  It does not start Docker."
echo "  It does not call external network services."
echo
echo "[OK] starting orchestrator..."

exec npm run dev --workspace @raiz/orchestrator
