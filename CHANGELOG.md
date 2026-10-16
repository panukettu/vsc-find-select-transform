# Changelog

## [0.2.0]

### Fixed

- Transforms are now compiled in-process with the TypeScript compiler bundled in VS Code (falling back
  to the workspace's `typescript`). The previous `npx tsc` call needed a TypeScript install next to the
  extension, which the published package does not contain, and surfaced as "An internal error occurred"
  plus an unhandled promise rejection on every startup.
- A missing transforms file no longer errors. The status bar offers to create the example file, and the
  **Transpile Transforms File** command does the same.
- Settings changes are observed even when the initial transpile failed.
- Transforms given as an array of functions are chained correctly (each function received the original text).
- Line transforms receive lines without their line break, and the `separator` option works.
- RegExp `additionalValues` placeholders are substituted (`$id`), no longer crash when nothing matches, and
  unrelated `$identifiers` in the text are left alone.
- `search.jumpSelection` is honoured (it was read under a different name), including `start`/`end`.
- Edits no longer accumulate across documents in a shared `WorkspaceEdit`.
- **Transform Repeat** repeats the previous selection transforms instead of the associations.
- Commands that fail no longer show a second generic "command resulted in an error" notification.
- Watching the transforms file works for paths outside the workspace (e.g. `<home>/...`).
- Relative imports in the transforms file are emitted and loaded correctly.

### Changed

- The compiled output is cached: an unchanged transforms file is not re-compiled on startup.
- Syntax errors in the transforms file are reported in the output channel; type errors are ignored.
- The status bar item shows `associated/total` transforms for the current file.
- No error popup on editor switch when a file type has no associations; a warning appears only when a
  transform command is run.
- The output channel is no longer forced open on startup.
- Edits whose output equals the input are skipped.
- Settings schema: `transform.regexp` documents `additionalValues`, examples are valid, `*` is accepted as an
  association key, the default association points to a transform of the example file.

### Added

- `bun run test:unit` unit tests; the integration test ships its own fixture workspace.
- Public API: `createExampleTransforms()`, `transpile(force?)`.

## [0.1.1]

- Reveal ranges

## [0.1.0]

- Initial release of the extension
