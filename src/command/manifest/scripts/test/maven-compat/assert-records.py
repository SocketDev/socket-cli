#!/usr/bin/env python3
# Assert the RECORDS the Coana Maven core extension emitted for the multi-module smoke project.
# Invoked by smoke-test.sh with the records file as its only argument; exits non-zero and prints every
# failure it found. Kept in its own file, rather than a heredoc inside smoke-test.sh, so the unit
# suite can run these assertions over synthetic records without Maven or a JDK.
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
tool = None
roots, nodes, files, direct = {}, {}, {}, {}
for r in rows:
    if r[0] == 'meta': tool = r[1]
    elif r[0] == 'root': roots[r[1]] = (r[4] == '1')                 # rootId -> prod
    elif r[0] == 'node':
        nodes.setdefault(r[2], set()).add(r[1])                      # coordId -> {rootId}
        if r[8] == '1': direct.setdefault(r[2], set()).add(r[1])     # coordId -> {rootId where direct}
    elif r[0] == 'file': files.setdefault(r[2], set()).add(r[3])     # coordId -> {path}

errors = []

def coord(prefix, fields=None):
    """The one emitted coordId starting with prefix, or None. Keeps assertions version-agnostic.

    fields pins the count of colon-separated fields. Without it a prefix that stops before the
    type, as the bare-id lookup below does, would also match the typed form it is meant to rule
    out: 'demo:lib:' is a prefix of both 'demo:lib:1.0' and 'demo:lib:jar:1.0'.
    """
    hits = sorted(
        c for c in set(nodes) | set(files)
        if c.startswith(prefix) and (fields is None or c.count(':') + 1 == fields)
    )
    if len(hits) > 1:
        errors.append(f"expected one coordinate for {prefix!r}, got {hits}")
    return hits[0] if hits else None

ext = coord('demo.ext:tool:jar:')
harness = coord('demo.ext:harness:jar:')
harness_core = coord('demo.ext:harness-core:jar:')
# Internal module: bare groupId:artifactId:version, no type field.
lib = coord('demo:lib:', fields=3)

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

if not lib: errors.append("internal module demo:lib not emitted by its bare id")
elif not in_prod(lib): errors.append("internal module demo:lib not in app's prod root")
elif not direct.get(lib): errors.append("internal module demo:lib not marked direct")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS: tool=maven; {ext} prod+jar; harness/harness-core dev; internal demo:lib (bare id, direct)")
