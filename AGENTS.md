# VoxType Agent Instructions

## Commits

All commit messages must follow Conventional Commits 1.0.0.

Use this format:

```text
<type>[optional scope][optional !]: <description>
```

Examples:

```text
fix(whisper): combine generated and override prompts
feat(ocr): add active-window screenshot capture
docs(planning): refresh recording coordination roadmap
build: add commit message validation
```

Prefer these common types:

- `feat` for user-visible features.
- `fix` for bug fixes.
- `docs` for documentation-only changes.
- `test` for tests only.
- `refactor` for behavior-preserving code restructuring.
- `perf` for performance improvements.
- `build` for build, dependency, packaging, or external tooling changes.
- `ci` for CI configuration.
- `style` for formatting-only changes.
- `chore` for maintenance.

Keep the subject concise and imperative. Use a breaking-change marker, such as
`feat(api)!: remove legacy transcription endpoint`, and a `BREAKING CHANGE:`
footer when a change is not backward compatible.
