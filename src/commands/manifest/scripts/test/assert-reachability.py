#!/usr/bin/env python3
# Assert the manifest REACHABILITY invariant over a records file emitted by any of the JVM
# build-tool scripts: every component must be reachable from a direct dependency by following
# `edge` rows, an edge kept only where both ends are nodes of its own root, as the assembler keeps
# it. By default each resolution root is checked on its own. With --per-project, a project's roots
# are merged as the assembler merges them, a node keyed by the build project it resolves to, if
# any. Maven needs that, as its compile root holds a node whose parent edge only its test root holds.
#
# The manifest consumer reports a component that is neither direct nor referenced as an "orphaned
# component not reachable from any direct dependency". An edge onto a node its own root does not
# hold is how that happens, so every ecosystem's smoke test runs this. Kept in its own file, rather
# than a heredoc inside each smoke-test.sh, so the unit suite can run it over synthetic records
# without a build tool or a JDK.
import argparse
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--per-project', action='store_true')
parser.add_argument('records')
args = parser.parse_args()

rows = [l.rstrip('\n').split('\t') for l in open(args.records) if l.strip()]
project_of = {r[1]: r[2] for r in rows if r[0] == 'root'}
label = 'project' if args.per_project else 'root'

ids_by_root = {}
for r in rows:
    if r[0] == 'node':
        project = r[9] if args.per_project and len(r) > 9 else ''
        ids_by_root.setdefault(r[1], {})[r[2]] = project or r[2]

coords, direct, adjacency = {}, {}, {}
for r in rows:
    if r[0] not in ('node', 'edge'):
        continue
    group = project_of.get(r[1], '') if args.per_project else r[1]
    ids = ids_by_root.get(r[1], {})
    if r[0] == 'node':
        coords.setdefault(group, set()).add(ids[r[2]])
        if r[8] == '1':
            direct.setdefault(group, set()).add(ids[r[2]])
    elif r[2] in ids and r[3] in ids:
        adjacency.setdefault(group, {}).setdefault(ids[r[2]], set()).add(ids[r[3]])

errors = []
for group, nodes in coords.items():
    seen = set(direct.get(group, ()))
    stack = list(seen)
    while stack:
        for child in adjacency.get(group, {}).get(stack.pop(), ()):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    unreachable = sorted(nodes - seen)
    if unreachable:
        errors.append(f"{label} {group}: unreachable from any direct dependency: {unreachable}")

if errors:
    print("FAIL:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print(f"PASS (reachability): {len(coords)} {label}(s), all components reachable from a direct dep")
