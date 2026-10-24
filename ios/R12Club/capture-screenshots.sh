#!/bin/bash
set -euo pipefail
capture_root="$(cd "$(dirname "$0")/../.." && pwd)"
capture_device="${R12_SIMULATOR_UDID:-9018276F-4E67-4A43-AB5A-393BB7C73517}"
capture_output="${R12_CAPTURE_OUTPUT:-$(mktemp -d /private/tmp/r12-club-screenshots.XXXXXX)}"
mkdir -p "$capture_output"
if [[ -e "$capture_output/Capture.xcresult" ]]; then
  echo 'Choose a new R12_CAPTURE_OUTPUT directory; the existing result will not be overwritten.' >&2
  exit 1
fi
cd "$capture_root"
R12_SCREENSHOT_SERVER=1 node tests/browser/run-club-reviewer.mjs > "$capture_output/fixture.log" 2>&1 &
capture_server_pid=$!
trap 'kill "$capture_server_pid" 2>/dev/null || true' EXIT
for capture_attempt in {1..30}; do
  if ! kill -0 "$capture_server_pid" 2>/dev/null; then cat "$capture_output/fixture.log" >&2; exit 1; fi
  if curl --fail --silent --output /dev/null http://127.0.0.1:3121/club/reception; then break; fi
  sleep 0.2
done
xcodebuild -project ios/R12Club/R12Club.xcodeproj -scheme R12Club -configuration Debug \
  -destination "platform=iOS Simulator,id=$capture_device" \
  -derivedDataPath "${R12_CAPTURE_DERIVED_DATA:-$capture_output/DerivedData}" -resultBundlePath "$capture_output/Capture.xcresult" \
  -only-testing:ClubNavigationUITests/ClubNavigationUITests/testLocalSyntheticScreenshotPresentation \
  CODE_SIGNING_ALLOWED=NO test > "$capture_output/xcodebuild.log" 2>&1
xcrun xcresulttool export attachments --path "$capture_output/Capture.xcresult" --output-path "$capture_output/attachments"
python3 - "$capture_output" <<'PY'
import json, shutil, sys
from pathlib import Path
out=Path(sys.argv[1]); manifest=json.loads((out/'attachments/manifest.json').read_text())
names=['01-Reception','02-Daily-Checks','03-Members','04-Shop']
for name in names:
    matches=[a for group in manifest for a in group['attachments'] if a['suggestedHumanReadableName'].startswith(name+'_') and a['exportedFileName'].endswith('.png')]
    if len(matches)!=1: raise SystemExit('Expected exactly one screenshot: '+name)
    shutil.copyfile(out/'attachments'/matches[0]['exportedFileName'],out/(name+'.png'))
print('Four synthetic iPhone simulator screenshots: '+str(out))
PY
