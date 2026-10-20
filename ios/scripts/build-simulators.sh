#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

apps=(R12 R12Club R12Coach GlowZone)
for app in "${apps[@]}"; do
  echo "Building $app for iOS Simulator (unsigned)"
  xcodebuild \
    -project "$app/$app.xcodeproj" \
    -scheme "$app" \
    -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    CODE_SIGNING_ALLOWED=NO \
    build
done
