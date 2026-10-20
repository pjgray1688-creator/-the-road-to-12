# Xcode Cloud preparation

Create one workflow for each shared scheme (`R12`, `R12Club`, `R12Coach`, `GlowZone`) after the four App Store Connect app records exist. Xcode Cloud workflows are configured in Xcode/App Store Connect; this repository does not need credentials or an invented YAML configuration.

Initial workflow settings:

- Source: the connected GitHub repository, branch `launch/r12-ios-preparation`.
- Start condition: manual on the launch branch while preparing; add pull-request checks once the branch strategy is agreed.
- Actions: build the app scheme for a generic iOS device; run static analysis. There are no XCTest targets yet, so do not claim automated unit/UI coverage.
- Signing: Automatic signing using the organisation's real Apple Developer Team selected in Xcode. Keep the actual Team ID, certificates and API keys in Apple-managed settings. Do not commit provisioning profiles or credentials.
- Distribution: archive only; disable automatic external release. Upload to TestFlight after the owner approves the archive and app record.

On the owner's Mac, connect the project to Xcode Cloud and use the **Product → Xcode Cloud → Create Workflow** flow for each scheme. Verify bundle ID, app record, signing team and archive export on that Mac. Xcode Cloud availability, Apple Developer Program access and App Store Connect permissions are required external inputs.
