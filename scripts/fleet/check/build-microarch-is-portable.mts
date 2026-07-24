#!/usr/bin/env node
/*
 * @file Fail-closed gate: match the microarch pin to WHO CONTROLS THE TARGET.
 *   The axis is control, not "never". Distributed to CPUs you do NOT control —
 *   published npm natives, downloadable CLIs, release artifacts — must NOT pin
 *   above the minimum supported microarch: portable SIMD is RUNTIME CPU
 *   DISPATCH, one binary detects the CPU at run time and uses AVX2/NEON when
 *   present, scalar/SSE2 otherwise. Baking the BUILD machine's ISA into a
 *   distributed artifact instead makes it SIGILL on any older CPU that lacks
 *   those instructions. A CONTROLLED target — a homogeneous datacenter fleet,
 *   a container constrained to known hardware, a per-microarch build matrix, or
 *   a local build where build host == run host — MAY pin to the guaranteed
 *   floor, annotated with the standing justification below. This gate scans
 *   build-config surfaces and fails on an un-annotated pin that raises the ISA
 *   floor of a distributed artifact:
 *
 *   1. Rust `-C target-cpu=native` / `target-cpu = "native"`, and a baseline
 *      `-C target-feature=+avx2`-style ISA-extension pin (avx/avx2/avx512/sse3+/
 *      fma/bmi/…). `+crt-static` and the like are NOT microarch and pass. Use
 *      `is_x86_feature_detected!` runtime dispatch instead.
 *   2. Go `GOAMD64=v2|v3|v4`. A single default v1 binary + `golang.org/x/sys/cpu`
 *      runtime dispatch still uses AVX2 when present and runs everywhere.
 *
 *   Scanned surfaces: `.cargo/config*.toml` + `config.repo.toml`, CI workflows
 *   (`.github/workflows/*.{yml,yaml}` RUSTFLAGS/GOAMD64 env), `mise.toml` /
 *   `mise/config.toml`, `Justfile`/`Makefile`, and `.cargo/*.sh` build scripts.
 *   Docs/skills that DISCUSS the pin in prose are `.md` and out of scope.
 *
 *   Exceptions mirror the soak-exclude convention — a temporary pin carries a
 *   removable date; standing trust does not. Annotate the pinned line, trailing
 *   comment OR the line directly above, in one of two shapes:
 *     (a) TEMPORARY local/bench pin, needs a sunset date:
 *         # microarch-pin: local-profiling | removable: YYYY-MM-DD
 *         # microarch-pin: bench | removable: YYYY-MM-DD
 *     (b) STANDING justified pin for a controlled target, needs a non-empty
 *         justification, no date:
 *         # microarch-pin: controlled-target - homogeneous CI fleet, x86-64-v3 guaranteed
 *         # microarch-pin: build-matrix - one artifact per ISA level, loader selects
 *   An annotated pin passes; a bare one, or a controlled-target/build-matrix
 *   marker with an empty justification, fails.
 *
 *   Usage: node scripts/fleet/check/build-microarch-is-portable.mts [--quiet]
 *   Exit codes: 0 — every distributed build is microarch-portable or the pin is
 *   annotated for a controlled target; 1 — at least one un-annotated microarch
 *   pin, or an empty-justification standing marker, in a build-config surface.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Rust `-C target-cpu=native` (RUSTFLAGS form, with or without a space after
// -C) and the bareword `target-cpu = "native"` TOML form both reduce to this:
// a `target-cpu=` assignment whose value is `native`.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const RUST_TARGET_CPU_RE = /target-cpu\s*=\s*["']?native\b/i

// Rust baseline ISA-extension pin: `target-feature=+avx2` and friends. Only
// x86 microarch extensions ABOVE the x86-64 baseline (SSE2) count — a `+avx2`
// build SIGILLs on a pre-Haswell CPU. Portable, non-microarch features like
// `+crt-static` are deliberately NOT in this set, so they pass.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const RUST_TARGET_FEATURE_RE =
  /target-feature\s*=\s*["']?[^"'\n]*\+(?:avx512[a-z0-9]*|avx2|avx|sse4a|sse4\.?2|sse4\.?1|ssse3|sse3|fma|bmi2|bmi1|bmi|popcnt|lzcnt|f16c)\b/i

// Go `GOAMD64=v2|v3|v4` (shell `=`, YAML `:` env). v1 is the portable baseline
// and passes; v2+ raises the floor and crashes on older CPUs.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const GO_GOAMD64_RE = /\bGOAMD64\s*[:=]\s*["']?v[234]\b/

// Shape (a) — TEMPORARY local/bench pin. Mirrors the soak-exclude dated
// convention `# published: … | removable: …`: a `microarch-pin:` marker naming
// a local reason plus a `removable: YYYY-MM-DD` sunset date.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EXCEPTION_TEMPORARY_RE =
  /#\s*microarch-pin:\s*(?:bench|local-profiling)\b[^\n]*\|\s*removable:\s*\d{4}-\d{2}-\d{2}/i

// Shape (b) — STANDING justified pin for a controlled target. Standing trust
// needs no sunset date but DOES need a non-empty justification after the dash,
// so an empty `controlled-target -` marker still fails.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EXCEPTION_STANDING_RE =
  /#\s*microarch-pin:\s*(?:build-matrix|controlled-target)\b\s*-\s*\S[^\n]*/i

export type MicroarchPinKind =
  | 'go-goamd64'
  | 'rust-target-cpu'
  | 'rust-target-feature'

export interface MicroarchPin {
  readonly file: string
  readonly kind: MicroarchPinKind
  readonly line: number
  readonly snippet: string
}

/**
 * True when a line carries a microarch-pin exception annotation — either the
 * TEMPORARY dated local/bench shape or the STANDING justified controlled-target
 * / build-matrix shape. Pure — the annotation may sit as a trailing comment on
 * the pinned line or on the line directly above it (see findMicroarchPins).
 */
export function isMicroarchException(line: string): boolean {
  return EXCEPTION_TEMPORARY_RE.test(line) || EXCEPTION_STANDING_RE.test(line)
}

/**
 * The microarch pin a single build-config line carries, or undefined. Pure and
 * annotation-agnostic — exemption is applied by findMicroarchPins.
 */
export function detectPinKind(line: string): MicroarchPinKind | undefined {
  if (RUST_TARGET_CPU_RE.test(line)) {
    return 'rust-target-cpu'
  }
  if (RUST_TARGET_FEATURE_RE.test(line)) {
    return 'rust-target-feature'
  }
  if (GO_GOAMD64_RE.test(line)) {
    return 'go-goamd64'
  }
  return undefined
}

/**
 * Every un-annotated microarch pin in one build-config file's text. A pin is
 * exempt when a temporary-dated or standing-justified annotation appears as a
 * trailing comment on the same line OR on the line directly above it. Pure —
 * the unit-test surface.
 */
export function findMicroarchPins(text: string, file: string): MicroarchPin[] {
  const lines = text.split('\n')
  const out: MicroarchPin[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const kind = detectPinKind(line)
    if (!kind) {
      continue
    }
    const exempt =
      isMicroarchException(line) ||
      (i > 0 && isMicroarchException(lines[i - 1]!))
    if (exempt) {
      continue
    }
    out.push({ file, kind, line: i + 1, snippet: line.trim() })
  }
  return out
}

// Build-config surfaces whose microarch pins ship in a distributed artifact.
// Prose (`.md`, `.mts`) is excluded so skills/docs/this file that DISCUSS the
// pin as a string don't self-trip.
/**
 * True when `relPath` is a build-config surface this gate scans. Pure — path is
 * normalized to forward slashes before matching (fleet path-hygiene rule).
 */
export function isBuildConfigPath(relPath: string): boolean {
  const norm = normalizePath(relPath)
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  if (/(?:^|\/)\.cargo\/config[\w.-]*\.toml$/.test(norm)) {
    return true
  }
  if (base === 'config.repo.toml') {
    return true
  }
  if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(norm)) {
    return true
  }
  if (base === '.mise.toml' || base === 'mise.toml') {
    return true
  }
  if (/(?:^|\/)\.?mise\/config\.toml$/.test(norm)) {
    return true
  }
  if (base === 'Justfile' || base === 'justfile') {
    return true
  }
  if (base === 'GNUmakefile' || base === 'Makefile' || base === 'makefile') {
    return true
  }
  if (/(?:^|\/)\.cargo\/[^/]+\.sh$/.test(norm)) {
    return true
  }
  return false
}

/**
 * Tracked build-config files under `repoRoot`, as repo-relative POSIX paths.
 * Reads the git index (never the working tree's untracked/ignored churn); an
 * empty list when `repoRoot` is not a git repo.
 */
export function collectBuildConfigFiles(repoRoot: string): string[] {
  const result = spawnSync('git', ['ls-files'], {
    cwd: repoRoot,
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .filter(isBuildConfigPath)
}

function describe(kind: MicroarchPinKind): string {
  switch (kind) {
    case 'go-goamd64':
      return 'Go GOAMD64 v2/v3/v4 pin — ship a v1 default binary + x/sys/cpu runtime dispatch'
    case 'rust-target-cpu':
      return 'Rust target-cpu=native — use is_x86_feature_detected! runtime dispatch'
    case 'rust-target-feature':
      return 'Rust baseline target-feature ISA pin — gate the ISA at run time, not build time'
    default:
      return 'microarch pin'
  }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const files = collectBuildConfigFiles(REPO_ROOT)
  const pins: MicroarchPin[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text: string
    try {
      text = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    } catch {
      continue
    }
    pins.push(...findMicroarchPins(text, rel))
  }
  if (pins.length > 0) {
    logger.fail(
      `[build-microarch-is-portable] ${pins.length} un-annotated microarch ` +
        `pin(s) in a build config — a build distributed to CPUs you do not ` +
        `control must detect the CPU at run time, not bake in the build ` +
        `machine's ISA:`,
    )
    for (let i = 0, { length } = pins; i < length; i += 1) {
      const p = pins[i]!
      logger.error(`  ✗ ${p.file}:${p.line} — ${describe(p.kind)}`)
      logger.error(`      ${p.snippet}`)
    }
    logger.error(
      '  Distributed target: use runtime CPU dispatch ' +
        '(is_x86_feature_detected! / x/sys/cpu), do not pin above the minimum ' +
        'supported microarch.',
    )
    logger.error(
      '  Controlled target — pinning to the guaranteed floor is legitimate. ' +
        'Annotate the pinned line, same line or the line above, in one shape:',
    )
    logger.error(
      '    temporary local/bench: ' +
        '# microarch-pin: local-profiling | removable: YYYY-MM-DD',
    )
    logger.error(
      '    standing controlled target: ' +
        '# microarch-pin: controlled-target - <why the floor is guaranteed>',
    )
    logger.error(
      '    standing build matrix: ' +
        '# microarch-pin: build-matrix - <how the loader selects the artifact>',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[build-microarch-is-portable] every build config is microarch-portable ' +
        'or pins only to a controlled target (no un-annotated ' +
        'target-cpu=native / GOAMD64 pin).',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
