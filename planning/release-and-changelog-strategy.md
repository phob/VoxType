# Release And Changelog Strategy

## Goal

VoxType should have consistent, user-facing release notes that do not depend on remembering to manually edit a changelog.

The strategy should work well with AI-assisted development while still giving the maintainer a review point before a public release.

## Recommended Direction

Use:

- Conventional Commits as the structured input.
- Release Please as the first release automation tool.
- A reviewable release PR before each public release.
- A generated `CHANGELOG.md` for public/user-facing release notes.
- The existing `planning/changelog.md` only for internal planning-memory updates.

## Why Release Please First

Release Please is a good initial fit because it:

- reads Conventional Commits from git history
- creates or updates a release PR
- updates changelog files and version files in that PR
- creates tags and GitHub Releases when the release PR is merged
- leaves a human review checkpoint before anything public happens

This is better for VoxType than a fully automatic release at the beginning. AI can help write good commits and release text, but the release PR gives the maintainer a clean place to review wording, version bump, and public notes.

## Alternatives

### Changesets

Good when:

- the project becomes a monorepo
- multiple packages need coordinated versions
- each PR should include an explicit user-facing change note
- commits are noisy or often not suitable as changelog source

Potential downside:

- adds an extra file per meaningful change
- may feel heavier before the app has multiple packages

### semantic-release

Good when:

- releases should be fully automated from CI
- the team is comfortable with strict Conventional Commit discipline
- publishing happens frequently and automatically

Potential downside:

- more magical
- fewer natural review points
- easier to publish awkward AI-written changelog entries if commit messages are poor

## Conventional Commit Style

Use this format:

```text
type(scope): short imperative summary
```

Common types:

- `feat`: user-visible feature
- `fix`: user-visible bug fix
- `perf`: user-visible performance improvement
- `docs`: documentation-only change
- `refactor`: internal code change with no user-visible behavior change
- `test`: test-only change
- `build`: build/package/dependency change
- `ci`: CI/release workflow change
- `chore`: maintenance

Examples:

```text
feat(dictation): add push-to-talk recording flow
fix(insertion): restore clipboard after paste insertion
perf(asr): reduce whisper worker startup time
docs(planning): add release changelog strategy
ci(release): add release-please workflow
```

Breaking changes should use either:

```text
feat(api)!: change transcript storage format
```

or a footer:

```text
BREAKING CHANGE: Transcript history now uses the v2 schema.
```

## Changelog Style

Public changelog entries should be written for users, not as raw commit logs.

Preferred sections:

- Added
- Changed
- Fixed
- Improved
- Removed
- Security

Example:

```markdown
## 0.3.0

### Added

- Added screen-aware dictation that can use OCR terms from the active window.
- Added a TeamViewer insertion profile with slower keyboard emulation.

### Fixed

- Fixed clipboard restoration after paste insertion fails.
```

## AI-Assisted Rules

When AI commits or prepares release notes:

- Prefer user-facing wording for `feat`, `fix`, and `perf`.
- Keep `refactor`, `test`, and most `chore` entries out of the public changelog unless users care.
- Do not expose internal implementation details unless they affect users.
- Mention privacy, local model behavior, and Windows compatibility changes clearly.
- Review generated release notes before merging the release PR.

## Planned Tooling

Added after the initial Electron scaffold:

- `release-please-config.json`
- `.release-please-manifest.json`
- `.github/workflows/release-please.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- Windows installer packaging in `.github/workflows/release-please.yml`, triggered only when Release Please creates a GitHub Release.

Optional future additions:

- commit helper or commit message template
- `commitlint` once the project wants stricter enforcement
- signed-installer workflow once a code-signing certificate/path is chosen

Current bootstrap version is `0.2.0` in `package.json` and `.release-please-manifest.json`.

After this setup is merged to `main`, future release-relevant commits should use Conventional Commits so Release Please can open release PRs.

## Version Alignment

The Electron package version and the Rust Windows helper version should stay aligned for public releases.

After the first public release, `native/windows-helper/Cargo.toml` and the helper package entry in `native/windows-helper/Cargo.lock` should use the same version as `package.json` and `.release-please-manifest.json`. Release Please is configured to update those Rust helper files through `extra-files`, so a future release such as `0.4.0` should update both the app package and the helper package to `0.4.0` in the release PR.

## Release Artifact Automation

When a Release Please PR is merged, the `release-please` workflow should:

1. Let Release Please create the tag and GitHub Release.
2. If `release_created` is true, run a Windows packaging job against the created tag.
3. Build the Rust Windows helper in release mode.
4. Run the Electron/Vite production build.
5. Package a Windows x64 NSIS installer with `electron-builder`.
6. Generate `SHA256SUMS.txt` for the setup executable, blockmap, and update metadata.
7. Upload the generated setup executable, blockmap, update metadata, and checksum manifest to the GitHub Release.

The initial installer is unsigned. `signAndEditExecutable` is disabled to avoid local unsigned packaging failures from electron-builder's Windows code-signing helper cache. Until signing is justified, GitHub Releases should include `SHA256SUMS.txt` so users can verify downloaded installer artifacts. A future signed-installer pass should restore executable metadata/signing once a code-signing path is chosen.

Packaged Windows builds should use `VoxType.exe` as the executable name and set Electron's app name to `VoxType`, so installed builds show the VoxType identity in Windows shell surfaces such as Task Manager. Development runs may still show Electron because they are launched through Electron's development executable.

## In-App Update Flow

The non-developer sidebar footer doubles as the update affordance:

- `Stable` means the installed version matches the latest GitHub Release or no installable release was found.
- `Update` appears in orange when the latest GitHub Release has a newer `VoxType-Setup-*-x64.exe` asset.
- Clicking `Update` downloads the installer into the app's user-data update cache, starts it with NSIS silent mode (`/S`), and immediately quits the running VoxType process so the installer can replace the executable.

This first updater path intentionally uses the same GitHub Release artifacts produced by Release Please packaging instead of a separate update feed.

## Relationship To Planning Changelog

There are two changelog concepts:

- `planning/changelog.md`: internal memory of planning updates.
- `CHANGELOG.md`: public release notes generated and reviewed during releases.

Do not mix them.

## First Release Bootstrap

The first public GitHub release is `0.3.1`.

Recommended approach:

1. Merge the Release Please setup and first-release README/planning cleanup.
2. Keep existing GitHub releases and tags so changelog compare links and Release Please history remain intact.
3. Use Conventional Commits for future release-relevant work.
4. Let Release Please open release PRs for later versions.

## First GitHub Release Scope

The first GitHub release should present VoxType as an early Windows-first, local-first dictation app with:

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
- Auto-update depends on GitHub Release installer assets and is intentionally simple for the first release.
- OCR context is best-effort and may not improve every difficult term even when text is visible on screen.
- Remote insertion behavior varies by app and remote-control tool; TeamViewer/RDP-style targets may need profile tuning.
- There is no first-run onboarding wizard yet.
- Developer diagnostics still exist for troubleshooting but should remain hidden in installed builds.

## Troubleshooting

### GitHub Actions cannot create pull requests

Error:

```text
release-please failed: GitHub Actions is not permitted to create or approve pull requests.
```

This is a repository setting, not a Release Please config problem.

Fix:

1. Open the GitHub repository settings.
2. Go to `Settings` -> `Actions` -> `General`.
3. Under `Workflow permissions`, choose `Read and write permissions`.
4. Enable `Allow GitHub Actions to create and approve pull requests`.
5. Save.
6. Re-run the failed `release-please` workflow.

Alternative:

Use a maintainer-owned personal access token stored as a repository secret and pass it to the Release Please action with `token`. This can also make CI run on Release Please PRs, but it is more credential management than the project needs at the start.
