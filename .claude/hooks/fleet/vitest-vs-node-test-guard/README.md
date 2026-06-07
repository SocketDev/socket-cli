# vitest-vs-node-test-guard

PreToolUse Edit/Write hook that blocks creating a file at a path the repo's
vitest `include` glob would pick up if that file imports `node:test`.

## Why

Mismatched runners produce confusing errors. A file at
`scripts/fleet/test/foo.test.mts` that uses `import test from 'node:test'` belongs
to Node's built-in test runner. But if the repo's `vitest.config.*` has
`include: ['scripts/**/*.test.*']`, vitest will load it, see no
`describe`/`it`/`test` registration, and emit:

    Error: No test suite found in file scripts/fleet/test/foo.test.mts

This was a real instance in socket-stuie — 4 `scripts/fleet/test/` files cascaded
from wheelhouse used `node:test` while the repo's vitest include caught
them.

## What it blocks

| Pattern                                                  | Block? |
| -------------------------------------------------------- | ------ |
| Write/Edit that adds `import test from 'node:test'`      |        |
| to a file matching the repo's vitest `include` glob      | yes    |
| Same import in a file NOT matching `include`             | no     |
| Vitest API (`describe`/`it`/`test` from `vitest`)        | no     |
| Existing `node:test` file with an unrelated body edit    | yes    |
| (the file imports `node:test`; the edit doesn't have to) |        |

## Bypass

Type the canonical phrase in a new message:

    Allow node-test-in-vitest-include bypass

Or — the long-term fix — add the file path to vitest's `exclude` array in
the vitest config.

## Detection

Reads `.config/repo/vitest.config.mts` (or the standard fleet alternatives),
parses the `include: [...]` literal array, converts each glob to a regex,
and tests the target file's repo-relative path. Fails open if the config
isn't found or the include globs aren't string literals (dynamic includes
can't be validated statically).
