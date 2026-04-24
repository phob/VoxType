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

Optional future additions:

- commit helper or commit message template
- `commitlint` once the project wants stricter enforcement
- build/package workflow that attaches Windows installers to GitHub Releases

Current bootstrap version is `0.1.0` in `package.json` and `.release-please-manifest.json`.

After this setup is merged to `main`, future release-relevant commits should use Conventional Commits so Release Please can open release PRs.

## Relationship To Planning Changelog

There are two changelog concepts:

- `planning/changelog.md`: internal memory of planning updates.
- `CHANGELOG.md`: public release notes generated and reviewed during releases.

Do not mix them.

## First Release Bootstrap

The repo starts with `0.1.0`.

Recommended approach:

1. Merge the Release Please setup.
2. Tag the initial baseline as `v0.1.0` if a clean starting release marker is desired.
3. Use Conventional Commits for future release-relevant work.
4. Let Release Please open release PRs for later versions.
