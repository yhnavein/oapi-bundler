# AGENTS.md

This file is guidance for agentic coding tools working in this repository.
It documents how to build, test, lint, and contribute code consistently.

## Project Snapshot

- Name: `oapi-bundler`
- Runtime target for package consumers: Node.js `>=22`
- Local developer tooling: Bun (tests, script execution)
- Source language: TypeScript (`src/`)
- Build output: CommonJS JavaScript in `dist/`

## Rule Files Status

The repository currently has no additional IDE/assistant rule files:

- No `.cursor/rules/` directory
- No `.cursorrules` file
- No `.github/copilot-instructions.md`

If any of these files are added later, treat them as higher-priority guidance.

## Canonical Commands

Run commands from repo root: `/Users/pdabrowski/puredev/oapi-bundler`.

### Install

```bash
bun install
```

### Build

```bash
bun run build
```

Notes:
- Build uses `sucrase` to transpile `src/` into `dist/`.
- Build also removes test artifacts from `dist/` via `bun run rm-tests`.

### Test (all)

```bash
bun test
```

### Test (single file)

```bash
bun test test/integration/bundle.spec.ts
```

### Test (single test name pattern)

```bash
bun test test/integration/bundle.spec.ts -t "keeps local refs"
```

### Type-check

`tsconfig.json` sets `noEmit: true`; use TypeScript directly:

```bash
bunx tsc --noEmit
```

### Lint / Format

There is a `biome.json` config but no npm script yet.
If Biome is available in your environment, use:

```bash
bunx @biomejs/biome check .
bunx @biomejs/biome format --write .
```

If Biome is not installed, do not add broad formatting churn unrelated to the task.

## Repository Layout

- `src/cli.ts`: CLI entrypoint (`oapi-bundler` binary)
- `src/index.ts`: programmatic exports
- `src/core/*`: bundling pipeline (collect, load, merge, resolve, normalize, validate, emit)
- `src/utils/*`: shared helpers (paths, JSON pointers)
- `test/integration/*`: bun:test integration coverage
- `test/fixtures/*`: YAML/JSON fixtures used by tests

## Code Style Rules

Follow existing patterns in `src/` and `test/`.

### Formatting

- Use 2-space indentation.
- Use single quotes for strings.
- Keep semicolons.
- Keep trailing commas where valid.
- Keep line width around 80 when practical.
- Use LF newlines.

### Imports

- Prefer `node:`-prefixed built-ins (`node:path`, `node:fs/promises`, `node:process`).
- Group imports in this order:
  1) Node built-ins
  2) External packages
  3) Internal modules
- Use `import type` for type-only imports.
- Prefer explicit relative paths in internal imports.

### Types and Data Modeling

- Prefer explicit interfaces/types for options and return contracts.
- Keep public API types in `src/core/types.ts` when broadly reused.
- Prefer `unknown` over `any` for untrusted data.
- Narrow with runtime checks (`typeof`, array checks, object guards).
- Use `Record<string, unknown>` for generic object payloads.

### Naming

- `camelCase` for variables/functions.
- `PascalCase` for classes/interfaces/types.
- `UPPER_SNAKE_CASE` for constants with global semantic meaning.
- File names should be kebab-case and descriptive (`collect-inputs.ts`).
- Error codes should be stable ALL_CAPS strings (`COMPONENT_CONFLICT`).

### Error Handling

- Use `BundlerError` for operational/domain errors.
- Include machine-readable `code` and concise message.
- Populate `details` for actionable context (pointer, file path, reason).
- In CLI, catch once at top-level and print formatted error.
- Do not swallow parsing/resolution errors silently.

### Async and IO

- Use async/await consistently.
- Keep filesystem access in core utility/pipeline modules.
- Cache expensive IO where appropriate (resolver/loader already does this).
- Preserve deterministic behavior when iterating over discovered files/keys.

### OpenAPI-Specific Behavior

- Preserve strict merge conflict semantics unless intentionally changing policy.
- Keep output deterministic for snapshot/diff friendliness.
- Maintain local schema refs in output (`#/components/schemas/...`).
- Avoid emitting external schema refs in final bundled doc.
- Keep path parameter normalization behavior (`in: path` => `required: true`).

## Testing Expectations For Changes

For feature or behavior changes, add or update tests in `test/integration/`.

Minimum expectation:
- Run focused tests for touched behavior.
- Run full `bun test` before finishing.

For resolver/merge changes, prefer fixture-based tests that cover:
- external refs
- recursive refs/cycles
- schema reuse strategy behavior
- conflict paths and error codes

## Change Hygiene

- Keep patches targeted; avoid unrelated refactors.
- Do not edit generated `dist/` files manually.
- Update `README.md` when changing CLI flags or behavior.
- Keep backward compatibility where possible; if breaking, document clearly.

## Release-Oriented Notes

- Package entry points are expected in `dist/` (`main`, `types`, `bin`).
- `bin` points to `dist/cli.js`; preserve shebang behavior in source.
- Consumers use Node runtime, even though local development uses Bun.

## Quick Agent Checklist

1. Read relevant `src/core/*` modules before modifying pipeline behavior.
2. Implement minimal coherent change.
3. Add/adjust fixture + integration tests.
4. Run `bun test`.
5. Run `bun run build`.
6. Summarize behavior changes and any new flags/options.
