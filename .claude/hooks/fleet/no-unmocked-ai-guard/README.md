# no-unmocked-ai-guard

**Trigger:** PreToolUse on Write/Edit/MultiEdit to a test file (`*.test.*` /
`*.spec.*`, or under `test/` / `__tests__/`) whose post-edit content calls
`spawnAiAgent(` but has no `vi.mock(`.

**Action:** BLOCKS. Spawning a real model from a test is slow, costly, and
non-deterministic. Mock the AI surface (`vi.mock`) and assert on the stub.

Sibling of `no-unmocked-net-guard` (raw HTTP). Pairs with the fleet vitest
setup's network fail-closed.

**Bypass:** type `Allow unmocked-ai-in-tests bypass` verbatim in a recent turn.

Fails open on non-test files / absent content.
