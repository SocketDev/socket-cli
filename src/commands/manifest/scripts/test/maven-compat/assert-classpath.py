#!/usr/bin/env python3
# Assert the `classpath` records the Coana Maven core extension emitted for the smoke project's app
# modules: the order Maven builds their classpaths in (a pre-order walk of the resolved graph, filtered
# by scope, the test scope moved last). app keeps demo.ext:libdep, which Maven leaves only under lib's
# test-jar node while the walk reaches lib's jar node first; app2 reaches lib's node through the
# test-jar first and still puts lib on the main classpath. Matches on groupId:artifactId, so versions
# can change freely.
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
root_project = {r[1]: r[2] for r in rows if r[0] == 'root'}

EXPECTED = {
    'demo:app:1.0': [
        'demo:mid', 'demo:lib', 'demo.ext:tool', 'demo.ext:shared', 'demo.ext:conflict-prod',
        'demo.ext:libdep', 'demo.ext:harness', 'demo.ext:harness-core', 'demo.ext:conflict-test',
    ],
    'demo:app2:1.0': ['demo.ext:libdep', 'demo:mid', 'demo:lib'],
}

errors = []
for project, expected in EXPECTED.items():
    nodes = {r[2] for r in rows if r[0] == 'node' and root_project.get(r[1]) == project}
    classpath = [r[2] for r in rows if r[0] == 'classpath' and r[1] == project]
    if sorted(classpath) != sorted(nodes):
        errors.append(f"{project}: classpath {sorted(classpath)} != its nodes {sorted(nodes)}")
    got = [':'.join(c.split(':')[:2]) for c in classpath]
    if got != expected:
        errors.append(f"{project}: classpath order {got} != {expected}")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS (classpath): {', '.join(EXPECTED)} in Maven's order, test scope last")
