#!/usr/bin/env python3
# Assert the `classpath` records the Coana Maven core extension emitted for the smoke project's app
# modules: each classpath in the order Maven builds it (a pre-order walk of the resolved graph, filtered
# by scope), with the output sets each reactor module's artifacts bring in. app keeps demo.ext:libdep,
# which Maven leaves only under lib's test-jar node while the walk reaches lib's jar node first.
# Matches on groupId:artifactId, so versions can change freely.
import sys

rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]

EXPECTED = {
    'demo:app:1.0': {
        'main': [
            ('demo:mid', 'main'), ('demo:lib', 'main'), ('demo.ext:tool', ''), ('demo.ext:shared', ''),
            ('demo.ext:conflict-prod', ''), ('demo.ext:libdep', ''),
        ],
        'test': [
            ('demo:mid', 'main'), ('demo:lib', 'main,test'), ('demo.ext:tool', ''), ('demo.ext:harness', ''),
            ('demo.ext:harness-core', ''), ('demo.ext:conflict-test', ''), ('demo.ext:shared', ''),
            ('demo.ext:conflict-prod', ''), ('demo.ext:libdep', ''),
        ],
    },
    'demo:app2:1.0': {
        'main': [('demo.ext:libdep', ''), ('demo:mid', 'main'), ('demo:lib', 'main')],
        'test': [('demo:lib', 'test,main'), ('demo.ext:libdep', ''), ('demo:mid', 'main')],
    },
}

errors = []
for project, classpaths in EXPECTED.items():
    for name, expected in classpaths.items():
        got = [(':'.join(r[3].split(':')[:2]), r[4] if len(r) > 4 else '')
               for r in rows if r[0] == 'classpath' and r[1] == project and r[2] == name]
        if got != expected:
            errors.append(f"{project} {name}: {got} != {expected}")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS (classpath): {', '.join(EXPECTED)} main and test classpaths in Maven's order")
