#!/usr/bin/env node
// Claude Code PreToolUse hook — Socket.dev dependency firewall.
//
// Intercepts Edit/Write tool calls to dependency manifest files across
// 17+ package ecosystems. Extracts newly-added dependencies, builds
// Package URLs (PURLs), and checks them against the Socket.dev API
// using the SDK v4 checkMalware() method.
//
// Diff-aware: when old_string is present (Edit), only deps that
// appear in new_string but NOT in old_string are checked.
//
// Caching: API responses are cached in-process with a TTL to avoid
// redundant network calls when the same dep is checked repeatedly.
// The cache auto-evicts expired entries and caps at MAX_CACHE_SIZE.
//
// Exit codes:
//   0 = allow (no new deps, all clean, or non-dep file)
//   2 = block (malware detected by Socket.dev)

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseNpmSpecifier,
  stringify,
} from '@socketregistry/packageurl-js'
import type { PackageURL } from '@socketregistry/packageurl-js'
import {
  SOCKET_PUBLIC_API_TOKEN,
} from '@socketsecurity/lib/constants/socket'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  normalizePath,
} from '@socketsecurity/lib/paths/normalize'
import { SocketSdk } from '@socketsecurity/sdk'
import type { MalwareCheckPackage } from '@socketsecurity/sdk'

// Local mirror of build-infra/lib/error-utils#errorMessage. Hook runs
// standalone (no workspace deps beyond @socketsecurity/*) so we can't import
// the shared helper, but the contract is identical.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const logger = getDefaultLogger()

// Per-request timeout (ms) to avoid blocking the hook on slow responses.
const API_TIMEOUT = 5_000
// Max PURLs per batch request (API limit is 1024).
const MAX_BATCH_SIZE = 1024
// How long (ms) to cache a successful API response (5 minutes).
const CACHE_TTL = 5 * 60 * 1_000
// Maximum cache entries before forced eviction of oldest.
const MAX_CACHE_SIZE = 500

// SDK instance using the public API token (no user config needed).
const sdk = new SocketSdk(SOCKET_PUBLIC_API_TOKEN, {
  timeout: API_TIMEOUT,
})

// --- types ---

// Extracted dependency with ecosystem type, name, and optional scope.
interface Dep {
  type: string
  name: string
  namespace?: string
  version?: string
}

// Shape of the JSON blob Claude Code pipes to the hook via stdin.
interface HookInput {
  tool_name: string
  tool_input?: {
    file_path?: string
    new_string?: string
    old_string?: string
    content?: string
  }
}

// Result of checking a single dep against the Socket.dev API.
interface CheckResult {
  purl: string
  blocked?: boolean
  reason?: string
}


// A cached API lookup result with expiration timestamp.
interface CacheEntry {
  result: CheckResult | undefined
  expiresAt: number
}

// Function that extracts deps from file content.
type Extractor = (content: string) => Dep[]

// --- cache ---

// Simple TTL + max-size cache for API responses.
// Prevents redundant network calls when the same dep is checked
// multiple times in a session. Evicts expired entries on every
// get/set, and drops oldest entries if the cache exceeds MAX_CACHE_SIZE.
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key)
  if (!entry) return
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return
  }
  return entry
}

function cacheSet(
  key: string,
  result: CheckResult | undefined,
): void {
  // Evict expired entries before inserting.
  if (cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k)
    }
  }
  // If still over capacity, drop the oldest entries (FIFO).
  if (cache.size >= MAX_CACHE_SIZE) {
    const excess = cache.size - MAX_CACHE_SIZE + 1
    let dropped = 0
    for (const k of cache.keys()) {
      if (dropped >= excess) break
      cache.delete(k)
      dropped++
    }
  }
  cache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL,
  })
}

// Manifest file suffix → extractor function.
// __proto__: null prevents prototype-pollution on lookups.
const extractors: Record<string, Extractor> = {
  __proto__: null as unknown as Extractor,
  '.csproj': extract(
    // .NET: <PackageReference Include="Newtonsoft.Json" Version="13.0" />
    /PackageReference\s+Include="([^"]+)"/g,
    (m): Dep => ({ type: 'nuget', name: m[1] })
  ),
  '.tf': extractTerraform,
  'Brewfile': extractBrewfile,
  'build.gradle': extractMaven,
  'build.gradle.kts': extractMaven,
  'Cargo.lock': extract(
    // Rust lockfile: [[package]]\nname = "serde"\nversion = "1.0.0"
    /name\s*=\s*"([\w][\w-]*)"/gm,
    (m): Dep => ({ type: 'cargo', name: m[1] })
  ),
  'Cargo.toml': (content: string): Dep[] => {
    // Rust: extract crate names from dep lines.
    //
    // Two-mode strategy because the hook receives either a full
    // Cargo.toml (Write) or a fragment (Edit's new_string, often just
    // the added line with no section header):
    //
    //   Full file  — scan only [dependencies] / [dev-dependencies] /
    //                [build-dependencies] (incl. target-specific
    //                [target.*.dependencies] via the `.<name>` suffix)
    //                and skip [package], [features], [profile], etc.
    //   Fragment   — no section headers at all → treat the whole
    //                content as an implicit [dependencies] body and
    //                match any `name = "..."` or `name = { version = "..." }`.
    //
    // The lineRe requires the value to look like a version spec
    // (string or table with a `version` key), so `[features]`-style
    // `key = ["derive"]` array values don't match even in fragment mode.
    const deps: Dep[] = []
    const depSectionRe = /^\[(?:(?:dev-|build-)?dependencies(?:\.[^\]]+)?|target\.[^\]]+\.(?:dev-|build-)?dependencies(?:\.[^\]]+)?)\]\s*$/gm
    const anySectionRe = /^\[/gm
    const lineRe = /^(\w[\w-]*)\s*=\s*(?:\{[^}]*version\s*=\s*"[^"]*"|\s*"[^"]*")/gm
    const push = (section: string) => {
      let m
      while ((m = lineRe.exec(section)) !== null) {
        deps.push({ type: 'cargo', name: m[1] })
      }
      lineRe.lastIndex = 0
    }
    const hasAnySection = /^\[/m.test(content)
    if (!hasAnySection) {
      push(content)
      return deps
    }
    let sectionMatch
    while ((sectionMatch = depSectionRe.exec(content)) !== null) {
      const sectionStart = sectionMatch.index + sectionMatch[0].length
      anySectionRe.lastIndex = sectionStart
      const nextSection = anySectionRe.exec(content)
      const sectionEnd = nextSection ? nextSection.index : content.length
      push(content.slice(sectionStart, sectionEnd))
    }
    return deps
  },
  'conanfile.py': extractConan,
  'conanfile.txt': extractConan,
  'composer.lock': extract(
    // PHP lockfile: "name": "vendor/package"
    /"name":\s*"([a-z][\w-]*)\/([a-z][\w-]*)"/g,
    (m): Dep => ({
      type: 'composer',
      namespace: m[1],
      name: m[2],
    })
  ),
  'composer.json': extract(
    // PHP: "vendor/package": "^3.0"
    /"([a-z][\w-]*)\/([a-z][\w-]*)":\s*"/g,
    (m): Dep => ({
      type: 'composer',
      namespace: m[1],
      name: m[2],
    })
  ),
  'flake.nix': extractNixFlake,
  'Gemfile.lock': extract(
    // Ruby lockfile: indented gem names under GEM > specs
    /^\s{4}(\w[\w-]*)\s+\(/gm,
    (m): Dep => ({ type: 'gem', name: m[1] })
  ),
  'Gemfile': extract(
    // Ruby: gem 'rails', '~> 7.0'
    /gem\s+['"]([^'"]+)['"]/g,
    (m): Dep => ({ type: 'gem', name: m[1] })
  ),
  'go.sum': extract(
    // Go checksum file: module/path v1.2.3 h1:hash=
    /([\w./-]+)\s+v[\d.]+/gm,
    (m): Dep => {
      const parts = m[1].split('/')
      return {
        type: 'golang',
        name: parts.pop()!,
        namespace: parts.join('/') || undefined,
      }
    }
  ),
  'go.mod': extract(
    // Go: github.com/gin-gonic/gin v1.9.1
    /([\w./-]+)\s+v[\d.]+/gm,
    (m): Dep => {
      const parts = m[1].split('/')
      return {
        type: 'golang',
        name: parts.pop()!,
        namespace: parts.join('/') || undefined,
      }
    }
  ),
  'mix.exs': extract(
    // Elixir: {:phoenix, "~> 1.7"}
    /\{:(\w+),/g,
    (m): Dep => ({ type: 'hex', name: m[1] })
  ),
  'package-lock.json': extractNpmLockfile,
  'package.json': extractNpm,
  'Package.swift': extract(
    // Swift: .package(url: "https://github.com/vapor/vapor.git", from: "4.0.0")
    /\.package\s*\(\s*url:\s*"https:\/\/github\.com\/([^/]+)\/([^"]+)".*?from:\s*"([^"]+)"/gs,
    (m): Dep => ({
      type: 'swift',
      namespace: `github.com/${m[1]}`,
      name: m[2].replace(/\.git$/, ''),
      version: m[3],
    })
  ),
  'Pipfile.lock': extractPipfileLock,
  'pnpm-lock.yaml': extractNpmLockfile,
  'poetry.lock': extract(
    // Python poetry lockfile: [[package]]\nname = "flask"
    /name\s*=\s*"([a-zA-Z][\w.-]*)"/gm,
    (m): Dep => ({ type: 'pypi', name: m[1] })
  ),
  'pom.xml': extractMaven,
  'Project.toml': extract(
    // Julia: JSON3 = "uuid-string"
    /^(\w[\w.-]*)\s*=\s*"/gm,
    (m): Dep => ({ type: 'julia', name: m[1] })
  ),
  'pubspec.lock': extract(
    // Dart lockfile: top-level package names at column 2
    /^  (\w[\w_-]*):/gm,
    (m): Dep => ({ type: 'pub', name: m[1] })
  ),
  'pubspec.yaml': extract(
    // Dart: flutter_bloc: ^8.1.3 (2-space indented under dependencies:)
    /^\s{2}(\w[\w_-]*):\s/gm,
    (m): Dep => ({ type: 'pub', name: m[1] })
  ),
  'pyproject.toml': extractPypi,
  'requirements.txt': extractPypi,
  'setup.py': extractPypi,
  'yarn.lock': extractNpmLockfile,
}

// --- core ---

// Orchestrates the full check: extract deps, diff against old, query API.
async function check(hook: HookInput): Promise<number> {
  // Normalize backslashes and collapse segments for cross-platform paths.
  const filePath = normalizePath(
    hook.tool_input?.file_path || ''
  )

  // GitHub Actions workflows live under .github/workflows/*.yml
  const isWorkflow =
    /\.github\/workflows\/.*\.ya?ml$/.test(filePath)
  const extractor = isWorkflow
    ? extractGitHubActions
    : findExtractor(filePath)
  if (!extractor) return 0

  // Edit provides new_string; Write provides content.
  const newContent =
    hook.tool_input?.new_string
    ?? hook.tool_input?.content
    ?? ''
  const oldContent = hook.tool_input?.old_string ?? ''

  const newDeps = extractor(newContent)
  if (newDeps.length === 0) return 0

  // Diff-aware: only check deps added in this edit, not pre-existing.
  const deps = oldContent
    ? diffDeps(newDeps, extractor(oldContent))
    : newDeps
  if (deps.length === 0) return 0

  // Check all deps via SDK checkMalware().
  const blocked = await checkDepsBatch(deps)

  if (blocked.length > 0) {
    logger.error(`Socket: blocked ${blocked.length} dep(s):`)
    for (const b of blocked) {
      logger.error(`  ${b.purl}: ${b.reason}`)
    }
    return 2
  }
  return 0
}

// Check deps against Socket.dev using SDK v4 checkMalware().
// Deps already in cache are skipped; results are cached after lookup.
async function checkDepsBatch(
  deps: Dep[],
): Promise<CheckResult[]> {
  const blocked: CheckResult[] = []

  // Partition deps into cached vs uncached.
  const uncached: Array<{ dep: Dep; purl: string }> = []
  for (const dep of deps) {
    const purl = stringify(dep as unknown as PackageURL)
    const cached = cacheGet(purl)
    if (cached) {
      if (cached.result?.blocked) blocked.push(cached.result)
      continue
    }
    uncached.push({ dep, purl })
  }

  if (!uncached.length) return blocked

  try {
    // Process in chunks to respect API batch size limit.
    for (let i = 0; i < uncached.length; i += MAX_BATCH_SIZE) {
      const batch = uncached.slice(i, i + MAX_BATCH_SIZE)
      const components = batch.map(({ purl }) => ({ purl }))

      const result = await sdk.checkMalware(components)

      if (!result.success) {
        logger.warn(
          `Socket: API returned ${result.status}, allowing all`
        )
        return blocked
      }

      // Build lookup keyed by full PURL (includes namespace + version).
      const purlByKey = new Map<string, string>()
      for (const { dep, purl } of batch) {
        const ns = dep.namespace ? `${dep.namespace}/` : ''
        purlByKey.set(`${dep.type}:${ns}${dep.name}`, purl)
      }

      for (const pkg of result.data as MalwareCheckPackage[]) {
        const ns = pkg.namespace ? `${pkg.namespace}/` : ''
        const key = `${pkg.type}:${ns}${pkg.name}`
        const purl = purlByKey.get(key)
        if (!purl) continue

        // Check for malware alerts.
        const malware = pkg.alerts.find(
          a => a.severity === 'critical' || a.type === 'malware'
        )
        if (malware) {
          const cr: CheckResult = {
            purl,
            blocked: true,
            reason: `${malware.type} — ${malware.severity ?? 'critical'}`,
          }
          cacheSet(purl, cr)
          blocked.push(cr)
          continue
        }

        // No malware alerts — clean dep.
        cacheSet(purl, undefined)
      }
    }
  } catch (e) {
    // Network failure — log and allow all deps through.
    logger.warn(`Socket: network error (${errorMessage(e)}), allowing all`)
  }

  return blocked
}

// Return deps in `newDeps` that don't appear in `oldDeps` (by PURL).
function diffDeps(newDeps: Dep[], oldDeps: Dep[]): Dep[] {
  const old = new Set(
    oldDeps.map(d => stringify(d as unknown as PackageURL))
  )
  return newDeps.filter(
    d => !old.has(stringify(d as unknown as PackageURL))
  )
}

// Match file path suffix against the extractors map.
function findExtractor(
  filePath: string,
): Extractor | undefined {
  for (const [suffix, fn] of Object.entries(extractors)) {
    if (filePath.endsWith(suffix)) return fn
  }
}

// --- extractor factory ---

// Higher-order function: takes a regex and a match→Dep transform,
// returns an Extractor that applies matchAll and collects results.
function extract(
  re: RegExp,
  transform: (m: RegExpExecArray) => Dep | undefined,
): Extractor {
  return (content: string): Dep[] => {
    const deps: Dep[] = []
    for (const m of content.matchAll(re)) {
      const dep = transform(m as RegExpExecArray)
      if (dep) deps.push(dep)
    }
    return deps
  }
}

// --- ecosystem extractors (alphabetic) ---

// Homebrew (Brewfile): brew "package" or tap "owner/repo".
function extractBrewfile(content: string): Dep[] {
  const deps: Dep[] = []
  // brew "git", cask "firefox", tap "homebrew/cask"
  for (const m of content.matchAll(
    /(?:brew|cask)\s+['"]([^'"]+)['"]/g
  )) {
    deps.push({ type: 'brew', name: m[1] })
  }
  return deps
}

// Conan (C/C++): "boost/1.83.0" in conanfile.txt,
// or requires = "zlib/1.3.0" in conanfile.py.
function extractConan(content: string): Dep[] {
  const deps: Dep[] = []
  for (const m of content.matchAll(
    /([a-z][\w.-]+)\/[\d.]+/gm
  )) {
    deps.push({ type: 'conan', name: m[1] })
  }
  return deps
}

// GitHub Actions: "uses: owner/repo@ref" in workflow YAML.
// Handles subpaths like "org/repo/subpath@v1".
function extractGitHubActions(content: string): Dep[] {
  const deps: Dep[] = []
  for (const m of content.matchAll(
    /uses:\s*['"]?([^@\s'"]+)@([^\s'"]+)/g
  )) {
    const parts = m[1].split('/')
    if (parts.length >= 2) {
      deps.push({
        type: 'github',
        namespace: parts[0],
        name: parts.slice(1).join('/'),
      })
    }
  }
  return deps
}

// Maven/Gradle (Java/Kotlin):
//   pom.xml: <groupId>org.apache</groupId><artifactId>commons</artifactId>
//   build.gradle(.kts): implementation 'group:artifact:version'
function extractMaven(content: string): Dep[] {
  const deps: Dep[] = []
  // XML-style Maven POM declarations.
  for (const m of content.matchAll(
    /<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g
  )) {
    deps.push({
      type: 'maven',
      namespace: m[1],
      name: m[2],
    })
  }
  // Gradle shorthand: implementation/api/compile 'group:artifact:ver'
  for (const m of content.matchAll(
    /(?:implementation|api|compile)\s+['"]([^:'"]+):([^:'"]+)(?::[^'"]*)?['"]/g
  )) {
    deps.push({
      type: 'maven',
      namespace: m[1],
      name: m[2],
    })
  }
  return deps
}

// Convenience entry point for testing: route any file path
// through the correct extractor and return all deps found.
function extractNewDeps(
  rawFilePath: string,
  content: string,
): Dep[] {
  // Normalize backslashes and collapse segments for cross-platform.
  const filePath = normalizePath(rawFilePath)
  const isWorkflow =
    /\.github\/workflows\/.*\.ya?ml$/.test(filePath)
  const extractor = isWorkflow
    ? extractGitHubActions
    : findExtractor(filePath)
  return extractor ? extractor(content) : []
}

// Nix flakes (flake.nix): inputs.name.url = "github:owner/repo"
// or inputs.name = { url = "github:owner/repo"; };
function extractNixFlake(content: string): Dep[] {
  const deps: Dep[] = []
  // Match github:owner/repo patterns in flake inputs.
  for (const m of content.matchAll(
    /github:([^/\s"]+)\/([^/\s"]+)/g
  )) {
    deps.push({
      type: 'github',
      namespace: m[1],
      name: m[2].replace(/\/.*$/, ''),
    })
  }
  return deps
}

// npm lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock):
// Each format references packages differently:
//   package-lock.json: "node_modules/@scope/name" or "node_modules/name"
//   pnpm-lock.yaml: /@scope/name@version or /name@version
//   yarn.lock: "@scope/name@version" or name@version
function extractNpmLockfile(content: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()

  // package-lock.json: "node_modules/name" or "node_modules/@scope/name"
  for (const m of content.matchAll(
    /node_modules\/((?:@[\w.-]+\/)?[\w][\w.-]*)/g
  )) {
    addNpmDep(m[1], deps, seen)
  }
  // pnpm-lock.yaml: '/name@ver' or '/@scope/name@ver'
  // yarn.lock: "name@ver" or "@scope/name@ver"
  for (const m of content.matchAll(
    /['"/]((?:@[\w.-]+\/)?[\w][\w.-]*)@/gm
  )) {
    addNpmDep(m[1], deps, seen)
  }
  return deps
}

// Deduplicated npm dep insertion using parseNpmSpecifier.
function addNpmDep(
  raw: string,
  deps: Dep[],
  seen: Set<string>,
): void {
  if (seen.has(raw)) return
  seen.add(raw)
  if (raw.startsWith('.') || raw.startsWith('/')) return
  if (raw.startsWith('@') || /^[a-z]/.test(raw)) {
    const { namespace, name } = parseNpmSpecifier(raw)
    if (name) deps.push({ type: 'npm', namespace, name })
  }
}

// npm (package.json): "name": "version" or "@scope/name": "ver".
// Only matches entries where the value looks like a version/range/specifier,
// not arbitrary string values like scripts or config.
function extractNpm(content: string): Dep[] {
  const deps: Dep[] = []
  for (const m of content.matchAll(
    /"(@?[^"]+)":\s*"([^"]*)"/g
  )) {
    const raw = m[1]
    const val = m[2]
    // Skip builtins, relative, and absolute paths.
    if (
      raw.startsWith('node:')
      || raw.startsWith('.')
      || raw.startsWith('/')
    ) continue
    // Value must look like a version specifier: semver, range, workspace:,
    // catalog:, npm:, *, latest, or starts with ^~><=.
    if (!/^[\^~><=*]|^\d|^workspace:|^catalog:|^npm:|^latest$/.test(val)) continue
    // Only lowercase or scoped names are real deps.
    // Exclude known package.json metadata fields that look like deps.
    if (PACKAGE_JSON_METADATA_KEYS.has(raw)) continue
    if (raw.startsWith('@') || /^[a-z]/.test(raw)) {
      const { namespace, name } = parseNpmSpecifier(raw)
      if (name) deps.push({ type: 'npm', namespace, name })
    }
  }
  return deps
}

// package.json metadata fields that match the "key": "value" dep pattern but aren't deps.
const PACKAGE_JSON_METADATA_KEYS = new Set([
  'name', 'version', 'description', 'main', 'module', 'browser', 'types',
  'typings', 'license', 'homepage', 'repository', 'bugs', 'author',
  'type', 'engines', 'os', 'cpu', 'publishConfig', 'access',
  'sideEffects', 'unpkg', 'jsdelivr', 'exports',
])

// Pipfile.lock: JSON with "default" and "develop" sections keyed by package name.
function extractPipfileLock(content: string): Dep[] {
  const deps: Dep[] = []
  try {
    const lock = JSON.parse(content) as Record<string, Record<string, unknown>>
    for (const section of ['default', 'develop']) {
      const packages = lock[section]
      if (packages && typeof packages === 'object') {
        for (const name of Object.keys(packages)) {
          deps.push({ type: 'pypi', name })
        }
      }
    }
  } catch {
    // JSON.parse fails on partial content (e.g. Edit new_string fragments).
    // Fall back to regex matching package name keys in Pipfile.lock JSON.
    for (const m of content.matchAll(/"([a-zA-Z][\w.-]*)"\s*:\s*\{/g)) {
      deps.push({ type: 'pypi', name: m[1] })
    }
  }
  return deps
}

// PyPI (requirements.txt, pyproject.toml, setup.py):
// requirements.txt: package>=1.0 or package==1.0 at line start
// pyproject.toml: "package>=1.0" in dependencies arrays
// setup.py: "package>=1.0" in install_requires lists
function extractPypi(content: string): Dep[] {
  const deps: Dep[] = []
  const seen = new Set<string>()
  // requirements.txt style: package name at line start, followed by
  // version specifier, extras bracket, or end of line.
  for (const m of content.matchAll(
    /^([a-zA-Z][\w.-]+)\s*(?:[>=<!~\[;]|$)/gm
  )) {
    const name = m[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      deps.push({ type: 'pypi', name: m[1] })
    }
  }
  // Quoted strings with version specifiers (pyproject.toml, setup.py).
  for (const m of content.matchAll(
    /["']([a-zA-Z][\w.-]+)\s*[>=<!~\[]/g
  )) {
    const name = m[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      deps.push({ type: 'pypi', name: m[1] })
    }
  }
  return deps
}

// Terraform (.tf): module/provider source strings.
// Matches registry sources like "hashicorp/aws" and
// source = "owner/module/provider" patterns.
function extractTerraform(content: string): Dep[] {
  const deps: Dep[] = []
  // Registry module sources: source = "hashicorp/consul/aws"
  for (const m of content.matchAll(
    /source\s*=\s*"([^/"\s]+)\/([^/"\s]+)(?:\/[^"]*)?"/g
  )) {
    deps.push({
      type: 'terraform',
      namespace: m[1],
      name: m[2],
    })
  }
  return deps
}

export {
  cache,
  cacheGet,
  cacheSet,
  checkDepsBatch,
  diffDeps,
  extractBrewfile,
  extractConan,
  extractGitHubActions,
  extractMaven,
  extractNewDeps,
  extractNixFlake,
  extractNpm,
  extractNpmLockfile,
  extractPypi,
  extractTerraform,
  findExtractor,
}

// --- main (only when executed directly, not imported) ---
//
// Kept at the bottom because the module uses top-level await
// (`for await (const chunk of process.stdin)`) to read the hook payload.
// Top-level await suspends module evaluation at the suspension point, so
// any `const` declared AFTER the suspending block is still in the TDZ
// when the awaited work calls back into the module (e.g. extractNpm →
// PACKAGE_JSON_METADATA_KEYS). Placing main last guarantees every
// module-level declaration is initialized before main runs.

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // Read the full JSON blob from stdin (piped by Claude Code).
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const hook: HookInput = JSON.parse(input)

  if (hook.tool_name !== 'Edit' && hook.tool_name !== 'Write') {
    process.exitCode = 0
  } else {
    process.exitCode = await check(hook)
  }
}
