import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath, firewallVersionSegments } from './parser-utils.mts'
const gemName = '(?<name>[a-zA-Z0-9_.]+(?:-[a-zA-Z_.][a-zA-Z0-9_.]*)*)'
const dotOnlyVersion = '(?<version>\\d+(?:\\.[0-9a-zA-Z]+)*)'
const CPU =
  '(?:universal(?:\\.x86_64)?|x86_64|x86|x64|amd64|i[3-6]86|aarch64|arm64|armv[67]l?|armv6|arm|powerpc64le|powerpc|ppc64le|riscv64|s390x|sparc)'
const BARE_PLATFORM =
  '(?:java[0-9.]*|jruby|dalvik[0-9]*|darwin[0-9.]*|linux|freebsd|mswin32|mingw32)'
const OS_KEYWORD =
  '(?:darwin|linux|freebsd|openbsd|netbsd|solaris|cygwin|aix|hpux|mingw32|mingw64|mingw|mswin32|mswin64|mswin|ucrt|gnueabihf|musleabihf|androideabi|android|gnu|musl|dotnet|\\.net|rubinius|macruby|windows|universal|java|jruby|ruby)'
const PLATFORM_SEGMENT = `(?:${OS_KEYWORD}[0-9.]*|[0-9]+(?:\\.[0-9]+)*)`
const platform = `(?<platform>(?:${CPU}|${BARE_PLATFORM})(?:-${PLATFORM_SEGMENT})*)`
const gemPlatformUrl = new RegExp(
  `^/gems/${gemName}-${dotOnlyVersion}-${platform}\\.gem$`,
)
const gemUrl = new RegExp(
  ['^/gems/', gemName, '-', ...firewallVersionSegments, '\\.gem$'].join(''),
)
const gemspecPlatformUrl = new RegExp(
  `^/quick/Marshal[.0-9]+/${gemName}-${dotOnlyVersion}-${platform}\\.gemspec\\.rz$`,
)
const gemspecUrl = new RegExp(
  [
    '^/quick/Marshal[.0-9]+/',
    gemName,
    '-',
    ...firewallVersionSegments,
    '\\.gemspec\\.rz$',
  ].join(''),
)

export function parseRubyGemsUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)
  const match =
    pathname.match(gemPlatformUrl) ??
    pathname.match(gemspecPlatformUrl) ??
    pathname.match(gemUrl) ??
    pathname.match(gemspecUrl)
  if (!match?.groups) {
    return undefined
  }

  const { name, version, platform: platformQualifier } = match.groups
  return {
    name: name!,
    type: 'gem',
    version,
    ...(platformQualifier
      ? { qualifiers: { platform: platformQualifier } }
      : {}),
  }
}
