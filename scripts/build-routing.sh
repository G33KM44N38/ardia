#!/bin/bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
export XCODE_XCCONFIG_FILE="$repo/apps/browser/macos/Routing.xcconfig"
exec "$repo/scripts/agent/build-app" --as routing --config Release "$@"
