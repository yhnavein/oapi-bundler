# oapi-bundler

`oapi-bundler` merges modular OpenAPI files (YAML/JSON) into one output OpenAPI document.

It is designed for real-world spec trees where files are split by domain, operation, or component and connected with `$ref`.

## What It Does

- Accepts multiple positional inputs (exact files and globs).
- Merges multiple OpenAPI roots with strict conflict detection.
- Resolves local and external `$ref`.
- Produces a single output file (`.yaml/.yml` or `.json`).
- Enforces path parameter correctness (`in: path` gets `required: true`).
- Handles recursive schemas safely using local refs (`#/components/schemas/*`).
- Supports schema reuse strategies to balance readability vs deduplication.

## Install

Node.js `22+` is required.

```bash
npm install oapi-bundler
```

Run via CLI:

```bash
npx oapi-bundler <inputs...> -o <output-file>
```

## CLI Usage

```bash
oapi-bundler <inputs...> -o <output-file> [options]
```

### Inputs

Each positional argument is treated as an input pattern:

- exact file path
- glob pattern

Matched files are deduplicated by canonical absolute path and processed in deterministic order.

### Required Options

- `-o, --output <file>`: destination output path

### Optional Options

- `--format <yaml|json>`
  - If omitted, inferred from output extension.
  - `.yaml`/`.yml` => `yaml`, `.json` => `json`.
- `--validate <basic|strict>` (default: `basic`)
  - `basic`: core OpenAPI shape checks.
  - `strict`: additional checks (currently includes duplicate `operationId` detection).
- `--fail-on-warning` (default: `false`)
- `--max-depth <n>` (default: `200`)
- `--debug-resolver` (prints resolver traversal edges)
- `--schema-reuse <inline|minimal|aggressive>` (default: `inline`)

## Schema Reuse Strategies

All output refs are local refs in the same file (`#/components/schemas/...`).

### `inline` (default)

- Inlines one-use schemas where possible.
- Keeps local refs for recursive/cyclic schemas.
- Keeps refs for repeated schema usage.

Best default for readability without breaking cycles.

### `minimal`

- Inlines as much as possible.
- Keeps local refs only where needed for cycles/recursion.

Useful if you want highly inlined output.

### `aggressive`

- Reuses schemas more broadly.
- Performs structural deduplication with strict deep equality.
- Equality includes metadata fields (for example `description`, `title`, `example`).

Useful for reducing output size and component duplication.

## Examples

Single root file:

```bash
oapi-bundler specs/root.yaml -o dist/openapi.yaml
```

Glob inputs with JSON output:

```bash
oapi-bundler "specs/**/*.yaml" -o dist/openapi.json --format json
```

Strict validation + aggressive schema reuse:

```bash
oapi-bundler specs/root.yaml "specs/fragments/**/*.yaml" \
  -o dist/openapi.yaml \
  --validate strict \
  --schema-reuse aggressive
```

Debug resolver traversal:

```bash
oapi-bundler specs/root.yaml -o dist/openapi.yaml --debug-resolver
```

## Merge and Conflict Behavior

`oapi-bundler` is strict by default:

- Duplicate `components.<section>.<name>` with different content => error.
- Duplicate path+method operation with different content => error.
- Conflicting top-level keys => error.

For `openapi`, versions must match; for `info`, the first root document is treated as canonical.

## Output Guarantees

- Single output OpenAPI document.
- Deterministic ordering for stable diffs.
- No external schema refs in final result (schema refs are local).
- Path parameters are normalized (`required: true`).

## Exit Codes

- `0`: success
- `1`: failure (parse issues, unresolved refs, merge conflicts, validation failures, etc.)

## Programmatic API

You can use it as a library as well:

```ts
import { bundleDocuments, bundleToFile } from 'oapi-bundler';

const result = await bundleDocuments(['specs/root.yaml'], process.cwd(), {
  outputFormat: 'yaml',
  validate: 'basic',
  schemaReuse: 'inline',
});

await bundleToFile(['specs/root.yaml'], 'dist/openapi.yaml', process.cwd(), {
  outputFormat: 'yaml',
  schemaReuse: 'aggressive',
});
```

## Development

This repository uses Bun for local development tasks:

```bash
bun test
bun run build
```

The distributed package targets Node.js runtime (`>=22`) for consumers.
