#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-./vendor}"
mkdir -p "$ROOT_DIR"
cd "$ROOT_DIR"

echo "Cloning RAIZ Video Factory upstream/reference repositories into: $(pwd)"

clone_or_update() {
  local url="$1"
  local dir="$2"
  if [ -d "$dir/.git" ]; then
    echo "Updating $dir"
    git -C "$dir" pull --ff-only || true
  else
    echo "Cloning $dir"
    git clone "$url" "$dir"
  fi
}

# Core / primary
clone_or_update "https://github.com/gyoridavid/short-video-maker.git" "short-video-maker"
clone_or_update "https://github.com/remotion-dev/remotion.git" "remotion"

# Arabic/fallback/reference engines
clone_or_update "https://github.com/harry0703/MoneyPrinterTurbo.git" "MoneyPrinterTurbo"
clone_or_update "https://github.com/rushindrasinha/youtube-shorts-pipeline.git" "youtube-shorts-pipeline"
clone_or_update "https://github.com/Hritikraj8804/Autotube.git" "Autotube"
clone_or_update "https://github.com/mifi/editly.git" "editly"
clone_or_update "https://github.com/moshehbenavraham/vidapi.git" "vidapi"

# Reference only — do not use as v1 core without license/architecture review
clone_or_update "https://github.com/mutonby/openshorts.git" "openshorts"
clone_or_update "https://github.com/calesthio/OpenMontage.git" "OpenMontage"
clone_or_update "https://github.com/FujiwaraChoki/MoneyPrinterV2.git" "MoneyPrinterV2_REFERENCE_ONLY"

echo "Done. Review licenses before copying code into RAIZ."
