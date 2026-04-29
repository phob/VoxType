# VoxType Agent Instructions

## Commits

Commit messages do not need to follow Conventional Commits for the release
system. Keep them concise and imperative.

Useful examples:

```text
fix(whisper): combine generated and override prompts
feat(ocr): add active-window screenshot capture
docs(planning): refresh recording coordination roadmap
build: add commit message validation
```

Release notes are based on PR titles and GitHub labels, not individual commit
messages. For release-relevant pull requests, make the PR title user-facing and
apply an appropriate changelog label such as `feature`, `bug`, `improvement`,
`performance`, `ui`, `ux`, `documentation`, `build`, `ci`, `dependencies`, or
`refactor`. Use `skip-changelog` for changes that should stay out of public
release notes.

Mention breaking changes clearly in the PR title/body and final GitHub Release
notes.
