#!/usr/bin/env python3
# Assert the extension reported the unresolvable dependency, and only that: no scope-less or
# whole-module failure may be invented for a reactor whose graph collected fine. Counting the
# artifact's own failures is deliberately loose: it depends on how each Maven version words them,
# while the no-invented-failure invariant does not.
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
failures = [r[1:] for r in rows if r[0] == 'failure']
ghost = [f for f in failures if f[0].startswith('demo.missing:ghost:')]
# A failure with no scope, or an unscannable module, would claim graph collection failed.
graph = [f for f in failures if not f[2]] + [r[1:] for r in rows if r[0] == 'unscannable']
errors = []

if not ghost:
    errors.append(f"unresolvable demo.missing:ghost emitted no failure record; failures={failures}")
elif any(f[2] != 'compile' for f in ghost):
    errors.append(f"demo.missing:ghost should fail in config 'compile', got {[f[2] for f in ghost]}")
if graph:
    errors.append(f"every module's graph collected fine, so no graph-level failure should exist: {graph}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (no invented failures): demo.missing:ghost reported in config 'compile'; no graph-level failure")
