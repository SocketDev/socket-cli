#!/usr/bin/env python3
# Assert the extension reported the unresolvable dependency, and only that: no module-level `graph`
# failure may be invented for a reactor whose graph collected fine. Counting the artifact's own
# failures is deliberately loose — identical messages collapse in the shared accumulator, so the
# count depends on how each Maven version words them, while the `graph` invariant does not.
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
failures = [r[1:] for r in rows if r[0] == 'failure']
ghost = [f for f in failures if f[0].startswith('demo.missing:ghost:')]
graph = [f for f in failures if f[2] == 'graph']
errors = []

if not ghost:
    errors.append(f"unresolvable demo.missing:ghost emitted no failure record; failures={failures}")
elif any(f[2] != 'compile' for f in ghost):
    errors.append(f"demo.missing:ghost should fail in config 'compile', got {[f[2] for f in ghost]}")
if graph:
    errors.append(f"every module's graph collected fine, so no 'graph' failure should exist: {graph}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("PASS (no invented failures): demo.missing:ghost reported in config 'compile'; no module-level 'graph' failure")
