#!/bin/bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
configuration=Routing
if [[ "${1:-}" == --developer ]]; then
  configuration=RoutingDeveloper
  shift
fi
export XCODE_XCCONFIG_FILE="$repo/apps/browser/macos/$configuration.xcconfig"
exec "$repo/scripts/agent/build-app" --as routing --config Release "$@"
