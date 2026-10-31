#!/usr/bin/env python3
"""Generate a local NuGet feed of stub packages for the dotnet compat fixtures.

Like ../make-stub-repo.sh for the JVM fixtures: the fixtures only need the
shape of a dependency graph, never the code, so each stub is a nuspec plus
empty files, generated at test time and never committed.

Usage: make-stub-feed.py <feed-dir> <spec>...
  spec = Id:Version[+DepId:DepRange,...][#flag,...]
  flags:
    analyzer       no runtime assembly, only analyzers/dotnet/cs/<Id>.dll
    test           build/<Id>.props sets IsTestProject, as Microsoft.NET.Test.Sdk does
    payload        no assemblies; build/<Id>.targets and a native file it would copy
    buildtool      no assemblies; build/<Id>.targets, a developmentDependency
    rid=<rid>      its assembly is runtimes/<rid>/lib/netstandard2.0/<Id>.dll only
    runtime=<rid>  runtime.json makes it depend on runtime.<rid>.<Id> for <rid>
"""
import os
import shutil
import sys
import zipfile
from xml.sax.saxutils import escape


def parse(spec):
    flags = []
    if '#' in spec:
        spec, flag_text = spec.split('#', 1)
        flags = [f for f in flag_text.split(',') if f]
    deps = []
    if '+' in spec:
        spec, dep_text = spec.split('+', 1)
        deps = [d.split(':', 1) for d in dep_text.split(',') if d]
    pkg_id, version = spec.split(':', 1)
    return pkg_id, version, deps, flags


def nuspec(pkg_id, version, deps, flags):
    dep_xml = ''.join(
        f'<dependency id="{escape(d)}" version="{escape(v)}" />' for d, v in deps
    )
    dev = (
        '<developmentDependency>true</developmentDependency>'
        if 'analyzer' in flags or 'buildtool' in flags
        else ''
    )
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">'
        f'<metadata><id>{escape(pkg_id)}</id><version>{escape(version)}</version>'
        f'<authors>socket</authors><description>stub</description>{dev}'
        f'<dependencies><group>{dep_xml}</group></dependencies></metadata></package>'
    )


def main():
    feed = sys.argv[1]
    specs = sys.argv[2:]
    if not specs:
        sys.exit('make-stub-feed.py: no package specs given')
    shutil.rmtree(feed, ignore_errors=True)
    os.makedirs(feed)
    for spec in specs:
        pkg_id, version, deps, flags = parse(spec)
        files = {f'{pkg_id}.nuspec': nuspec(pkg_id, version, deps, flags)}
        rid = next((f[4:] for f in flags if f.startswith('rid=')), None)
        runtime = next((f[8:] for f in flags if f.startswith('runtime=')), None)
        if 'analyzer' in flags:
            files[f'analyzers/dotnet/cs/{pkg_id}.dll'] = ''
        elif 'payload' in flags or 'buildtool' in flags:
            files[f'build/{pkg_id}.targets'] = '<Project />'
            if 'payload' in flags:
                files[f'build/x64/{pkg_id}.native.dll'] = ''
        elif rid:
            files[f'runtimes/{rid}/lib/netstandard2.0/{pkg_id}.dll'] = ''
            files['lib/netstandard2.0/_._'] = ''
        else:
            files[f'lib/netstandard2.0/{pkg_id}.dll'] = ''
        if 'test' in flags:
            files[f'build/{pkg_id}.props'] = (
                '<Project><PropertyGroup><IsTestProject>true</IsTestProject>'
                '</PropertyGroup></Project>'
            )
        if runtime:
            files['runtime.json'] = (
                '{"runtimes": {"%s": {"%s": {"runtime.%s.%s": "%s"}}}}'
                % (runtime, pkg_id, runtime, pkg_id, version)
            )
        path = os.path.join(feed, f'{pkg_id.lower()}.{version}.nupkg')
        with zipfile.ZipFile(path, 'w') as z:
            for name, content in files.items():
                z.writestr(name, content)


if __name__ == '__main__':
    main()
