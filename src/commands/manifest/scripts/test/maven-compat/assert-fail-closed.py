#!/usr/bin/env python3
# Assert the extension failed CLOSED: a dependency it could not materialize must appear as a
# `failure` record, which the CLI turns into an aborted scan. Silently dropping the jar would leave
# the reachability analysis unable to see through that artifact and under-report reachability.
#
# Both fixture modules reach demo.scoped:widget, so both fail on it, each naming the repository it
# attempted — so the count of records is not pinned here. What is pinned: the failure is attributed
# to the artifact's own scope, never to a module-level `graph` failure, which would claim the
# dependency graph could not be built when it collected fine.
# smoke-test-duplicate-failure.sh covers the identical-message case, where those records collapse.
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
failures = [r[1:] for r in rows if r[0] == 'failure']
widget = [f for f in failures if f[0].startswith('demo.scoped:widget:')]
graph = [f for f in failures if f[2] == 'graph']
errors = []

if not widget:
    errors.append(f"an unresolvable dependency emitted no failure record; failures={failures}")
elif any(f[2] != 'compile' for f in widget):
    errors.append(f"demo.scoped:widget should fail in config 'compile', got {[f[2] for f in widget]}")
if graph:
    errors.append(f"graph collected fine, so no module-level 'graph' failure should exist: {graph}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (fail closed): unresolvable demo.scoped:widget reported in config 'compile' ({len(widget)} record(s)); no module-level 'graph' failure")
