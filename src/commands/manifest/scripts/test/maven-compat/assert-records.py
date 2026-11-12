#!/usr/bin/env python3
# Assert the RECORDS the Coana Maven core extension emitted for the multi-module smoke project.
# Invoked by smoke-test.sh with the records file as its only argument; exits non-zero and prints every
# failure it found. Kept in its own file, rather than a heredoc inside smoke-test.sh, so the unit
# suite can run these assertions over synthetic records without Maven or a JDK.
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
tool = None
roots, root_projects, nodes, projects, files, direct, edges = {}, {}, {}, {}, {}, {}, {}
for r in rows:
    if r[0] == 'meta': tool = r[1]
    elif r[0] == 'root':
        # rootId to prod and to projectKey.
        roots[r[1]] = (r[4] == '1')
        root_projects[r[1]] = r[2]
    elif r[0] == 'node':
        nodes.setdefault(r[2], set()).add(r[1])                      # coordId -> {rootId}
        if r[8] == '1': direct.setdefault(r[2], set()).add(r[1])     # coordId -> {rootId where direct}
        # coordId to the build projects its rows resolve it to.
        projects.setdefault(r[2], set()).add(r[9] if len(r) > 9 else '')
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])     # coordId -> {path}
    elif r[0] == 'edge':
        # (parent, child) to the roots that hold the edge.
        edges.setdefault((r[2], r[3]), set()).add(r[1])

errors = []

# NOTE: smoke-test.sh also assembles the records (../assemble-records.mts), which fails on an
# orphaned component. What remains here is Maven-specific: which coordinate lands in which root,
# and jar materialization.

def coord(prefix):
    """The one emitted coordId starting with prefix, or None. Keeps assertions version-agnostic."""
    hits = sorted(c for c in set(nodes) | set(files) if c.startswith(prefix))
    if len(hits) > 1:
        errors.append(f"expected one coordinate for {prefix!r}, got {hits}")
    return hits[0] if hits else None

ext = coord('demo.ext:tool:jar:')
harness = coord('demo.ext:harness:jar:')
harness_core = coord('demo.ext:harness-core:jar:')
# Sibling module demo:lib: app reaches its jar through mid and declares its test-jar.
lib_jar, lib_tests = coord('demo:lib:jar:'), coord('demo:lib:test-jar:')

if tool != 'maven': errors.append(f"meta tool {tool!r} != 'maven'")

def in_prod(cid): return any(roots.get(rid) for rid in nodes.get(cid, ()))
def has_jar(cid): return any(p.endswith('.jar') for p in files.get(cid, ()))

if not ext: errors.append("missing external prod dep demo.ext:tool")
elif not in_prod(ext): errors.append("demo.ext:tool not in a prod root")
elif not has_jar(ext): errors.append(f"demo.ext:tool jar not materialized: {files.get(ext)}")

if not harness: errors.append("missing test dep demo.ext:harness")
elif in_prod(harness): errors.append("test dep demo.ext:harness wrongly in a prod root")
elif not has_jar(harness): errors.append(f"demo.ext:harness jar not materialized: {files.get(harness)}")
if not harness_core: errors.append("missing transitive test dep demo.ext:harness-core")
elif in_prod(harness_core): errors.append("transitive test dep demo.ext:harness-core wrongly in a prod root")

def edge_roots(parent, child):
    return edges.get((parent, child), set())

def direct_in(cid, project): return any(root_projects.get(rid) == project for rid in direct.get(cid, ()))

if 'demo:lib:1.0' in nodes: errors.append("sibling demo:lib emitted under its bare id")
elif not lib_jar or not lib_tests: errors.append("sibling demo:lib's jar or test-jar missing")
elif projects.get(lib_jar, set()) | projects.get(lib_tests, set()) != {'demo:lib:1.0'}:
    errors.append("sibling demo:lib's artifacts do not name demo:lib:1.0 as their project")
elif not any(roots.get(rid) and root_projects.get(rid) == 'demo:app:1.0' for rid in nodes.get(lib_jar, ())):
    errors.append("sibling demo:lib's jar not in app's prod root")
elif not any(root_projects.get(rid) == 'demo:app:1.0' for rid in edge_roots(coord('demo:mid:jar:'), lib_jar)):
    errors.append("edge demo:mid -> demo:lib's jar missing from app")
elif in_prod(lib_tests): errors.append("sibling demo:lib's test-jar wrongly in a prod root")
elif direct_in(lib_jar, 'demo:app:1.0'): errors.append("sibling demo:lib's jar wrongly direct in app")
elif not direct_in(lib_tests, 'demo:app:1.0'): errors.append("sibling demo:lib's test-jar not direct in app")

def edge_pair(parent, child):
    """Both coordinates, or None after reporting the missing ones."""
    found = (coord(parent), coord(child))
    missing = [p for p, c in zip((parent, child), found) if not c]
    if missing:
        errors.append(f"missing {', '.join(m.rstrip(':') for m in missing)}")
        return None
    return found

# Scope conflict: Maven keeps demo.ext:shared under the test parent but selects compile, the
# scope conflict-prod's path gives it, so it is on the runtime classpath. Its edge from
# conflict-prod, onto the copy Maven kept under the test parent, keeps it reachable in the prod root.
pair = edge_pair('demo.ext:conflict-prod:jar:', 'demo.ext:shared:jar:')
if pair:
    if not in_prod(pair[1]): errors.append("scope-conflict demo.ext:shared not in a prod root")
    elif not any(roots.get(rid) for rid in edge_roots(*pair)):
        errors.append("edge demo.ext:conflict-prod -> demo.ext:shared missing from a prod root")

# An edge onto a dependency Maven kept elsewhere: dup-io's dup-util is the direct one.
pair = edge_pair('demo.ext:dup-io:jar:', 'demo.ext:dup-util:jar:')
if pair and not edge_roots(*pair): errors.append("edge demo.ext:dup-io -> demo.ext:dup-util missing")

# A mediated edge: med-io asks for another med-util than mid declares, and points at mid's.
# coord() fails if the med-util version med-io asked for is also emitted.
pair = edge_pair('demo.ext:med-io:jar:', 'demo.ext:med-util:jar:')
if pair and not any(root_projects.get(rid) == 'demo:mid:1.0' for rid in edge_roots(*pair)):
    errors.append("edge demo.ext:med-io -> demo.ext:med-util missing from mid")

# A managed scope applies to a transitive dependency as it is: demo.ext:managed is compile under
# its test parent, so it is on the runtime classpath.
pair = edge_pair('demo.ext:mgd-test:jar:', 'demo.ext:managed:jar:')
if pair:
    if in_prod(pair[0]): errors.append("test dep demo.ext:mgd-test wrongly in a prod root")
    elif not in_prod(pair[1]): errors.append("managed-scope demo.ext:managed not in a prod root")
    elif not edge_roots(*pair): errors.append("edge demo.ext:mgd-test -> demo.ext:managed missing")

# An edge across the prod/dev split: container-lib (compile) onto container-api, which app
# declares provided. The edge is kept and container-api stays dev.
pair = edge_pair('demo.ext:container-lib:jar:', 'demo.ext:container-api:jar:')
if pair:
    if in_prod(pair[1]): errors.append("provided demo.ext:container-api wrongly in a prod root")
    elif not in_prod(pair[0]): errors.append("demo.ext:container-lib not in a prod root")
    elif not edge_roots(*pair):
        errors.append("edge demo.ext:container-lib -> demo.ext:container-api missing")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS: tool=maven; {ext} prod+jar; harness/harness-core dev; sibling demo:lib jar prod, test-jar direct; demo.ext:shared prod; edges onto kept dependencies")
