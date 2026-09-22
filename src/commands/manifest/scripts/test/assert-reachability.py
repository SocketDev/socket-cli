#!/usr/bin/env python3
# Assert the manifest REACHABILITY invariant over a records file emitted by any of the JVM
# build-tool scripts: within each resolution root, every component must be reachable from one of
# that root's direct dependencies by following `edge` rows.
#
# The manifest consumer reports a component that is neither direct nor referenced as an "orphaned
# component not reachable from any direct dependency". Porting a node to a root whose only parent
# edge lives in another root is exactly how that happens, so every ecosystem's smoke
# test runs this. Kept in its own file, rather than a heredoc inside each smoke-test.sh, so the unit
# suite can run it over synthetic records without a build tool or a JDK.
#
# Usage: assert-reachability.py <records.tsv>
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]

nodes_by_root, direct_by_root, edges_by_root = {}, {}, {}
for r in rows:
    if r[0] == 'node':
        nodes_by_root.setdefault(r[1], set()).add(r[2])
        if r[8] == '1':
            direct_by_root.setdefault(r[1], set()).add(r[2])
    elif r[0] == 'edge':
        edges_by_root.setdefault(r[1], set()).add((r[2], r[3]))

errors = []
for root_id, coords in nodes_by_root.items():
    adjacency = {}
    for parent, child in edges_by_root.get(root_id, ()):
        adjacency.setdefault(parent, set()).add(child)
    seen = set(direct_by_root.get(root_id, ()))
    stack = list(seen)
    while stack:
        for child in adjacency.get(stack.pop(), ()):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    unreachable = sorted(coords - seen)
    if unreachable:
        errors.append(f"root {root_id}: unreachable from any direct dependency: {unreachable}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (reachability): {len(nodes_by_root)} root(s), all components reachable from a direct dep")
