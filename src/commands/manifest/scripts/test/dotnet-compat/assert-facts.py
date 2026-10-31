#!/usr/bin/env python3
"""Fixture-specific assertions for the dotnet compat smoke test.

Usage: assert-facts.py <work-dir> <sdk-version> <cpm-entry> [phase]
  phase: (default) the plain runs; exclude-paths, include-configs,
  ignore-unresolved: the option runs; records: the --with-files records.
"""
import json
import os
import sys

WORK, SDK, CPM_ENTRY = sys.argv[1], sys.argv[2], sys.argv[3]
PHASE = sys.argv[4] if len(sys.argv) > 4 else 'default'
SDK_MAJOR = int(SDK.split('.')[0])
problems = []


def check(cond, message):
    if not cond:
        problems.append(message)


def load(rel):
    path = os.path.join(WORK, rel)
    check(os.path.exists(path), f'{rel}: missing')
    if not os.path.exists(path):
        return {'components': [], 'projects': [], 'dependencies': []}
    with open(path) as f:
        return json.load(f)


def comps(facts, name):
    return [c for c in facts['components'] if c['name'] == name]


def comp(facts, name, version=None):
    found = [c for c in comps(facts, name) if version is None or c.get('version') == version]
    check(len(found) == 1, f'{name}@{version}: expected one component, got {found}')
    return found[0] if found else {}


def project_ids(facts):
    return sorted(p['id'] for p in facts.get('projects', []))


def common(rel, facts):
    check(facts.get('metadata', {}).get('tool') == 'dotnet', f'{rel}: metadata.tool')
    for c in facts['components'] + facts.get('projects', []):
        check(c.get('type') == 'nuget', f'{rel}: {c["id"]} type {c.get("type")}')
        check('namespace' not in c, f'{rel}: {c["id"]} carries a namespace key')


def default_phase():
    basic = load('basic/Basic.sln.socket.facts.json')
    common('basic', basic)
    check(
        project_ids(basic) == [
            'src/App/App.csproj', 'src/Extra/Extra.csproj', 'src/Lib/Lib.csproj',
            'test/App.Tests/App.Tests.csproj',
        ],
        f'basic projects: {project_ids(basic)}',
    )
    lib = next(p for p in basic['projects'] if p['id'] == 'src/Lib/Lib.csproj')
    check((lib['name'], lib.get('version')) == ('Acme.Lib', '2.3.4'), f'Lib identity: {lib}')
    check(comp(basic, 'Acme.Lib').get('firstParty') is True, 'Lib as a component is first-party')
    check(comp(basic, 'Acme.Lib').get('id') == 'src/Lib/Lib.csproj', 'Lib component id')
    check(comp(basic, 'Demo.Ext.Floating').get('version') == '1.1.0', 'floating 1.* resolves to 1.1.0')
    check(comp(basic, 'Demo.Ext.Tool').get('dev') is None, 'Tool is prod')
    check(comp(basic, 'Demo.Ext.Shared').get('dev') is None, 'Shared is prod')
    for dev in ('Demo.Ext.Analyzer', 'Demo.Ext.TestSdk', 'Demo.Ext.Harness', 'Demo.Ext.HarnessCore'):
        check(comp(basic, dev).get('dev') is True, f'{dev} is dev')
    check(comp(basic, 'Demo.Ext.Analyzer').get('direct') is True, 'Analyzer is direct')
    check(comp(basic, 'Demo.Ext.HarnessCore').get('direct') is None, 'HarnessCore is transitive')
    check(bool(comps(basic, 'NETStandard.Library')), 'netstandard2.0 target read')
    app = next(p for p in basic['projects'] if p['id'] == 'src/App/App.csproj')
    check(app.get('manifestFiles') == [{'file': 'src/App/App.csproj'}], f'App manifestFiles {app.get("manifestFiles")}')

    cpm_facts = f'{CPM_ENTRY}.socket.facts.json'
    cpm = load(cpm_facts)
    common('cpm', cpm)
    pinned = comp(cpm, 'Demo.Ext.Shared')
    check(pinned.get('version') == '2.0.0' and not pinned.get('direct'), f'transitive pin: {pinned}')
    check({c.get('version') for c in comps(cpm, 'Demo.Ext.Harness')} == {'1.0.0', '1.1.0'}, 'VersionOverride')
    if SDK_MAJOR >= 7:
        # GlobalPackageReference needs NuGet 6.4 (SDK 7.0.100).
        analyzer = comp(cpm, 'Demo.Ext.Analyzer')
        check(analyzer.get('direct') and analyzer.get('dev'), f'GlobalPackageReference: {analyzer}')
    base = os.path.dirname(CPM_ENTRY)
    core_id = os.path.relpath('cpm/src/Core/Core.csproj', base)
    core = next((p for p in cpm['projects'] if p['id'] == core_id), {})
    files = {m['file'] for m in core.get('manifestFiles', [])}
    want = {os.path.relpath(f, base) for f in ('cpm/Directory.Packages.props', 'cpm/src/Core/Core.csproj', 'cpm/src/Core/packages.lock.json')}
    check(files == want, f'Core manifestFiles {files} != {want}')

    rid = load('rid/Rid.csproj.socket.facts.json')
    check(bool(comps(rid, 'runtime.win-x64.Demo.Ext.Native')), 'runtime-specific package from runtime.json')

    pc = load('packages-config/Mixed.sln.socket.facts.json')
    common('packages-config', pc)
    legacy = next((p for p in pc['projects'] if p['id'] == 'Legacy/Legacy.csproj'), {})
    check({m['file'] for m in legacy.get('manifestFiles', [])} == {'Legacy/Legacy.csproj', 'Legacy/packages.config'}, f'Legacy manifestFiles {legacy}')
    check(comp(pc, 'Demo.Ext.Shared', '1.0.0').get('direct') is True, 'packages.config versions normalize')
    check(comp(pc, 'Demo.Ext.Analyzer').get('dev') is True, 'developmentDependency is dev')
    check(comp(pc, 'Demo.Ext.Logging').get('direct') is True, 'Modern restored alongside Legacy')

    langs = load('langs/Vb/Vb.vbproj.socket.facts.json')
    check(project_ids(langs) == ['../Fs/Fs.fsproj', 'Vb.vbproj'], f'langs projects {project_ids(langs)}')
    check(bool(comps(langs, 'FSharp.Core')), 'implicit FSharp.Core')

    for rel in ('multi/One.sln', 'multi/Two.sln', 'multi/Stray.csproj'):
        load(f'{rel}.socket.facts.json')
    check(not os.path.exists(os.path.join(WORK, 'multi/One/One.csproj.socket.facts.json')), 'covered project built alone')
    check(not os.path.exists(os.path.join(WORK, 'multi/One.slnx.socket.facts.json')), 'covered solution built again')

    for name, package in (('A', 'Demo.Ext.Tool'), ('B', 'Demo.Ext.Logging')):
        pair = load(f'pair/{name}.csproj.socket.facts.json')
        check(project_ids(pair) == [f'{name}.csproj'], f'pair {name} projects {project_ids(pair)}')
        check(bool(comps(pair, package)), f'pair {name} resolves {package}')

    dev = load('dev/Dev.csproj.socket.facts.json')
    for name, is_dev in (('Demo.Ext.Tool', None), ('Demo.Ext.Shared', None), ('Demo.Ext.Logging', True), ('Demo.Ext.Analyzer', True), ('Demo.Ext.Payload', None), ('Demo.Ext.BuildTool', True)):
        check(comp(dev, name).get('dev') is is_dev, f'{name} dev={comp(dev, name).get("dev")}, want {is_dev}')

    load('sibling/sln/All.sln.socket.facts.json')
    check(not os.path.exists(os.path.join(WORK, 'sibling/src/A/A.csproj.socket.facts.json')), 'project a sibling solution covers built alone')

    with open(os.path.join(WORK, 'missing.log')) as f:
        log = f.read()
    check('Demo.Ext.DoesNotExist' in log and 'NU1101' in log, 'missing package reported')
    with open(os.path.join(WORK, 'broken.log')) as f:
        log = f.read()
    check('could not evaluate the project' in log, 'evaluation failure reported')


def records(name):
    rows = []
    with open(os.path.join(WORK, name)) as f:
        for line in f:
            rows.append(line.rstrip('\n').split('\t'))
    return rows


# Some SDKs' MSBuild finds no .NET Framework reference assemblies off Windows,
# which fails the legacy project's design-time build there, as its compile would.
def package_failures(rows):
    return [r for r in rows if r[0] == 'failure' and not r[2].startswith('the design-time build failed: MSB3644')]


def info_rows(rows, project, name, config=None):
    return [r for r in rows if r[0] == 'projectInfo' and r[1] == project and r[3] == name and config in (None, r[2])]


def records_phase():
    basic = records('basic.tsv')
    files = {r[2]: r[3] for r in basic if r[0] == 'file'}
    check(any(k.startswith('demo.ext.tool:') for k in files), 'Tool assembly recorded')
    check(not any(k.startswith('demo.ext.analyzer:') for k in files), 'analyzer has no runtime assembly')
    check(all(os.path.exists(p) for p in files.values()), 'recorded assemblies exist')
    lib_roots = [r for r in basic if r[0] == 'root' and r[2] == 'src/Lib/Lib.csproj']
    check({r[5] for r in lib_roots} == {'net6.0', 'netstandard2.0'}, f'root frameworks {[r[5] for r in lib_roots]}')
    check(all(r[7] == r[3] for r in lib_roots), f'root aliases {[(r[3], r[7]) for r in lib_roots]}')
    info = {(r[2], r[3], r[4]) for r in basic if r[0] == 'projectInfo' and r[1] == 'src/Lib/Lib.csproj'}
    check(('net6.0', 'TargetFrameworkMoniker', '.NETCoreApp,Version=v6.0') in info, 'net6.0 moniker recorded')
    check(('net6.0', 'DefineConstant', 'NET6_0_OR_GREATER') in info, 'implicit framework symbols recorded')
    check(('net6.0', 'FrameworkReference', 'Microsoft.NETCore.App') in info, 'framework reference recorded')
    check(any(r[0] == 'compileFile' and r[2].startswith('demo.ext.tool:') for r in basic), 'compile assemblies recorded')
    sources = [r[2] for r in basic if r[0] == 'projectSrc']
    check(any(s.endswith('/shared/Linked.cs') for s in sources), 'linked source recorded')
    check(any(s.endswith('.AssemblyInfo.cs') for s in sources), 'generated source recorded')
    errors = [r for r in basic if r[0] == 'projectInfo' and r[3] == 'BuildError']
    check(not errors, f'design-time build errors {errors}')
    refs = {r[4] for r in info_rows(basic, 'src/Lib/Lib.csproj', 'Reference', 'net6.0')}
    check(any(p.endswith('/System.Runtime.dll') for p in refs), 'framework reference assemblies recorded')
    # The stub packages' empty assemblies are not references the compiler
    # would take; a project reference's output is, built or not.
    check(any(p.endswith('/Extra.dll') for p in refs), 'project reference recorded')
    analyzers = {r[4] for r in info_rows(basic, 'src/Lib/Lib.csproj', 'Analyzer', 'net6.0')}
    check(any('demo.ext.analyzer' in p.lower() for p in analyzers), f'analyzers {analyzers}')

    designtime = records('designtime.tsv')
    failed = [r for r in designtime if r[0] == 'failure' and 'the design-time build failed' in r[2]]
    check(len(failed) == 1 and 'generated sources unavailable' in failed[0][2], f'design-time failure {failed}')

    langs = records('langs.tsv')
    vb = {r[4] for r in info_rows(langs, 'Vb.vbproj', 'DefineConstant')}
    check({'DEBUG=-1', 'TRACE=-1'} <= vb, f'VB compiler constants {vb}')
    fs = [r[2] for r in langs if r[0] == 'projectSrc' and r[1] == '../Fs/Fs.fsproj']
    check(len(fs) >= 2 and fs[-1].endswith('/Library.fs'), f'F# sources in compile order {fs}')
    check(not any(r[0] == 'failure' for r in basic), f'basic failures {[r for r in basic if r[0] == "failure"]}')

    missing = records('pc-missing.tsv')
    unfetched = {r[2] for r in missing if r[0] == 'unfetched'}
    check(unfetched == {'demo.ext.tool:1.0.0', 'demo.ext.shared:1.0.0'}, f'unfetched {unfetched}')
    check(len(package_failures(missing)) == 2, 'missing packages.config assemblies fail')

    present = records('pc-present.tsv')
    check(not package_failures(present) and not any(r[0] == 'unfetched' for r in present), 'installed packages.config resolves')
    legacy_roots = {(r[3], r[5], r[7]) for r in present if r[0] == 'root' and r[2] == 'Legacy/Legacy.csproj'}
    check(legacy_roots == {('net48', 'net48', 'net48')}, f'Legacy roots (config, framework, alias) {legacy_roots}')
    present_files = {r[2] for r in present if r[0] == 'file'}
    check({'demo.ext.tool:1.0.0', 'demo.ext.shared:1.0.0'} <= present_files, f'packages.config files {present_files}')


def main():
    if PHASE == 'default':
        default_phase()
    elif PHASE == 'exclude-paths':
        facts = load('basic/Basic.sln.socket.facts.json')
        check('test/App.Tests/App.Tests.csproj' not in project_ids(facts), 'excluded project resolved')
        check(not comps(facts, 'Demo.Ext.TestSdk'), 'excluded project dependencies emitted')
    elif PHASE == 'include-configs':
        facts = load('basic/Basic.sln.socket.facts.json')
        check(not comps(facts, 'NETStandard.Library'), 'netstandard2.0 target read despite --include-configs')
    elif PHASE == 'ignore-unresolved':
        facts = load('failures/missing/Missing.csproj.socket.facts.json')
        check(bool(comps(facts, 'Demo.Ext.Tool')), 'resolved dependency kept')
        check(not comps(facts, 'Demo.Ext.DoesNotExist'), 'unresolved dependency emitted')
    elif PHASE == 'records':
        records_phase()
    if problems:
        print('\n'.join(f'FAIL [{PHASE}] {p}' for p in problems))
        sys.exit(1)
    print(f'assert-facts: {PHASE} ok')


if __name__ == '__main__':
    main()
