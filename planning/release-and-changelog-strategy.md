# Release And Changelog Strategy

## Goal

VoxType should have intentional, user-facing releases with decent public notes, without making every commit message part of the release contract.

The release process should stay simple while the product is moving quickly:

- stable releases only for now
- maintainer-chosen version numbers
- explicit version alignment across Electron and the Rust helper
- GitHub Releases as the public changelog
- generated release notes based on PR titles and labels, with manual editing allowed before sharing

The existing `planning/changelog.md` remains internal planning memory and should not be mixed with public release notes.

## Current Direction

Use a T3-style stable release workflow, simplified for VoxType:

1. A maintainer manually dispatches the release workflow with a version such as `0.3.2`.
2. CI validates the version and checks that the tag does not already exist.
3. `scripts/sync-release-version.mjs` updates:
   - `package.json`
   - `package-lock.json`
   - `native/windows-helper/Cargo.toml`
   - `native/windows-helper/Cargo.lock`
4. CI builds the app to catch version-sync or TypeScript failures.
5. CI commits the version bump to `main` with `chore(release): prepare vX.Y.Z`.
6. CI creates and pushes tag `vX.Y.Z` at that version-bump commit.
7. CI builds the Windows x64 NSIS installer from the tag.
8. CI generates `SHA256SUMS.txt`.
9. CI creates a draft GitHub Release by default and uploads installer artifacts.
10. The maintainer reviews the release notes and publishes the draft once the changelog is acceptable.

This deliberately keeps releases manual. A person decides when a release is ready and which version number it deserves.

## Changelog Source

GitHub Releases are the public changelog.

Release notes can be supplied manually when dispatching the workflow. If no manual notes are supplied, GitHub generates notes using `.github/release.yml`, which groups merged PRs by labels:

- `feature` or `enhancement` -> Added
- `bug` or `fix` -> Fixed
- `improvement`, `performance`, `ui`, or `ux` -> Improved
- `documentation` -> Documentation
- `build`, `ci`, `dependencies`, or `refactor` -> Internal Changes
- `skip-changelog` -> excluded

This means release-note quality should come from PR titles and labels, not individual commit messages.

For small patch releases that do not have merged PRs, use the manual release-notes input. GitHub generated notes may otherwise collapse to a compare link only.

## PR Expectations

For changes that should appear in public release notes:

- Use a PR title that reads well as a user-facing changelog bullet.
- Apply one relevant changelog label.
- Use `skip-changelog` for internal work that should not appear in the release notes.
- Keep the PR template's Release Notes section useful enough that the final draft GitHub Release can be edited quickly if needed.

Commit messages no longer need to follow Conventional Commits for the release system.

## Version Alignment

The Electron package version and Rust Windows helper version should stay aligned for public releases.

The release workflow and local `npm run release:version -- <version>` script update all version files together. The release tag should point at the commit that contains the final synchronized version values.

## Release Artifact Automation

The stable release workflow should:

1. Build the Rust Windows helper in release mode.
2. Run the Electron/Vite production build.
3. Package a Windows x64 NSIS installer with `electron-builder`.
4. Generate `SHA256SUMS.txt` for the setup executable, blockmap, and update metadata.
5. Upload the generated setup executable, blockmap, update metadata, and checksum manifest to the GitHub Release.

The installer is unsigned until a signing path is justified. GitHub Releases should include checksums so users can verify downloaded artifacts.

Packaged Windows builds should use `VoxType.exe` as the executable name and set Electron's app name to `VoxType`, so installed builds show the VoxType identity in Windows shell surfaces such as Task Manager.

## In-App Update Flow

The non-developer sidebar footer doubles as the update affordance:

- `Stable` means the installed version matches the latest GitHub Release or no installable release was found.
- `Update` appears in orange when the latest GitHub Release has a newer `VoxType-Setup-*-x64.exe` asset.
- Clicking `Update` downloads the installer into the app's user-data update cache, starts the normal one-click NSIS installer, and immediately quits the running VoxType process so the installer can replace the executable. The installer should use its normal finish behavior, including launching VoxType after installation.

This first updater path intentionally uses the same GitHub Release artifacts produced by the stable release workflow instead of a separate update feed.

## First Release Scope

The first GitHub releases should present VoxType as an early Windows-first, local-first dictation app with:

- global-hotkey dictation
- local Whisper transcription through managed `whisper.cpp` runtimes
- native Windows microphone capture and Silero VAD
- active-window insertion through clipboard paste, Unicode typing, chunked typing, and remote-safe profiles
- local OCR-assisted context and dictionary support
- release UI separated from developer diagnostics
- unsigned Windows x64 NSIS installer artifacts attached to the GitHub Release

## Known First-Release Limitations

- The Windows installer is unsigned, so Windows SmartScreen may warn users.
- GitHub Releases include SHA256 checksums as the first trust/verification layer while the installer remains unsigned.
- Auto-update depends on GitHub Release installer assets and is intentionally simple for the first releases.
- OCR context is best-effort and may not improve every difficult term even when text is visible on screen.
- Remote insertion behavior varies by app and remote-control tool; TeamViewer/RDP-style targets may need profile tuning.
- There is no first-run onboarding wizard yet.
- Developer diagnostics still exist for troubleshooting but should remain hidden in installed builds.

## Superseded Direction

The earlier plan used Conventional Commits plus Release Please to generate release PRs and `CHANGELOG.md`.

That path is superseded because VoxType benefits more right now from:

- fewer release prerequisites
- not making commit-message format part of the product release contract
- release notes based on PR titles and labels
- a manual release button that keeps publication intentional
