#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${IOS_TEAM_ID:?Set IOS_TEAM_ID to your Apple Developer Team ID}"

apps=(R12 R12Club R12Coach GlowZone)
for app in "${apps[@]}"; do
  echo "Archiving $app for App Store distribution"
  xcodebuild \
    -project "$app/$app.xcodeproj" \
    -scheme "$app" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "build/archives/$app.xcarchive" \
    DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    -allowProvisioningUpdates \
    archive
done
