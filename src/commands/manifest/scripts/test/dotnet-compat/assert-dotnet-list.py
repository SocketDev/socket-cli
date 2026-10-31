#!/usr/bin/env python3
"""Compare a dotnet facts file with NuGet's own view of the same restore.

`dotnet list <entry> package --include-transitive --format json` reports, per
PackageReference project and target framework, the top-level and transitive
packages restore resolved. Each project's tree in the facts file must hold
exactly those packages, at those versions, with the top-level ones direct.

Runtime-specific targets are not part of `dotnet list`, so the facts file must
come from a run that skipped them (--exclude-configs '*/*'). SDK 7.x lists
ProjectReferences among the transitive packages; with it, entries named like
one of the build's own projects are left out.

Usage: assert-dotnet-list.py <facts.json> <entry> [dotnet]
"""
import json
import os
import subprocess
import sys


def nuget_view(entry, dotnet):
    cwd = os.path.dirname(os.path.abspath(entry))
    # Where available, read the restore under test instead of restoring again
    # (a restore of its own runs NuGet audit, which a project may fail on).
    help_text = subprocess.run(
        [dotnet, 'list', 'package', '--help'], capture_output=True, text=True, cwd=cwd,
    ).stdout
    no_restore = ['--no-restore'] if '--no-restore' in help_text else []
    # Exits non-zero, still printing its JSON, when a solution member is not
    # restored, as one the solution's configuration does not build.
    out = subprocess.run(
        [dotnet, 'list', entry, 'package', '--include-transitive', '--format', 'json', *no_restore],
        check=False,
        capture_output=True,
        text=True,
        cwd=cwd,
    ).stdout
    view = {}
    for project in json.loads(out).get('projects', []):
        if 'frameworks' not in project:
            continue
        direct, every = set(), set()
        for framework in project.get('frameworks', []):
            for pkg in framework.get('topLevelPackages', []):
                key = (pkg['id'].lower(), pkg['resolvedVersion'])
                direct.add(key)
                every.add(key)
            for pkg in framework.get('transitivePackages', []):
                every.add((pkg['id'].lower(), pkg['resolvedVersion']))
        view[os.path.realpath(project['path'])] = (direct, every)
    return view


def facts_view(facts, build_root):
    components = facts['components']
    deps = facts.get('dependencies', [])
    first_party = {p['id'] for p in facts.get('projects', [])}

    def key(index):
        c = components[index]
        return None if c['id'] in first_party else (c['name'].lower(), c.get('version', ''))

    view = {}
    for project in facts.get('projects', []):
        direct = {key(deps[i]['component']) for i in project['children']} - {None}
        every, stack, seen = set(), list(project['children']), set()
        while stack:
            i = stack.pop()
            if i in seen:
                continue
            seen.add(i)
            k = key(deps[i]['component'])
            if k:
                every.add(k)
            stack.extend(deps[i].get('children', []))
        path = os.path.realpath(os.path.join(build_root, project['id']))
        view[path] = (direct, every)
    return view


def main():
    facts_path, entry = sys.argv[1], os.path.abspath(sys.argv[2])
    dotnet = sys.argv[3] if len(sys.argv) > 3 else 'dotnet'
    with open(facts_path) as f:
        facts = json.load(f)
    ours = facts_view(facts, os.path.dirname(os.path.abspath(facts_path)))
    sdk = subprocess.run(
        [dotnet, '--version'], check=True, capture_output=True, text=True,
        cwd=os.path.dirname(entry),
    ).stdout.strip()
    own = {p['name'].lower() for p in facts.get('projects', [])} if sdk.startswith('7.') else set()
    theirs = {
        path: ({k for k in direct if k[0] not in own}, {k for k in every if k[0] not in own})
        for path, (direct, every) in nuget_view(entry, dotnet).items()
    }
    if not theirs:
        sys.exit(f'dotnet list reported no project of {entry}')
    problems = []
    for path, (direct, every) in sorted(theirs.items()):
        if path not in ours:
            problems.append(f'{path}: missing from the facts file')
            continue
        our_direct, our_every = ours[path]
        for label, a, b in (('direct', our_direct, direct), ('resolved', our_every, every)):
            if a != b:
                problems.append(
                    f'{path}: {label} differs; only in facts: {sorted(a - b)}; only in dotnet list: {sorted(b - a)}'
                )
    if problems:
        print('\n'.join(problems))
        sys.exit(1)
    print(f'facts match dotnet list for {len(theirs)} project(s)')


if __name__ == '__main__':
    main()
