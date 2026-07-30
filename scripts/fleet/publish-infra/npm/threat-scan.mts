/**
 * @file Opt-in local code-threat scan for the staged-publish gate. Where the
 *   archive full scan vets the DEPENDENCY graph, this reads the staged
 *   package's OWN source and asks a keyless on-device model to flag threats
 *   (install-hook abuse, network exfiltration, obfuscated/eval'd payloads).
 *   Keyless and no-spend: it drives socket-lib's `builtinLocalProvider`
 *   (`getLanguageModel()` → `node:smol-ai` on the node-smol runtime, Chrome
 *   built-in AI, Apple FM, or a loopback llama-server) via `spawnLocalAgent`;
 *   `ODAI_BACKEND` selects among them. A Gemini-Nano-class model is a coarse
 *   red-flag triage, not a Claude-grade analyst, so this is a first-pass filter
 *   behind `--threat-scan` — never the sole gate. The pure file-selection,
 *   prompt, verdict-parse, and failure-collection are unit-tested here; the
 *   model I/O is behind an injectable provider so tests never load a model.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  builtinLocalProvider,
  spawnLocalAgent,
} from '@socketsecurity/lib-stable/ai/spawn-local'
import type { LocalAgentProvider } from '@socketsecurity/lib-stable/ai/spawn-local'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { logger } from '../shared.mts'

// A coarse triage verdict for one scanned file.
export type ThreatVerdict = 'clean' | 'malicious' | 'suspicious'

// One file's verdict, with the model's reasons. `error` marks a file the model
// could not evaluate (a generation failure) so the gate can fail closed on it.
export interface ThreatFinding {
  confidence: number
  file: string
  reasons: string[]
  verdict: ThreatVerdict | 'error'
}

// The gate-facing outcome. `available:false` means no local model resolved —
// the caller decides whether that fails closed (it does when the scan was
// explicitly requested).
export interface ThreatScanResult {
  available: boolean
  findings: ThreatFinding[]
}

// How a verdict blocks the publish. `suspicious` blocks only at/above the
// confidence floor; `malicious` and an unevaluable `error` always block.
export interface ThreatPolicy {
  suspiciousConfidenceFloor: number
}

export const DEFAULT_THREAT_POLICY: ThreatPolicy = {
  suspiciousConfidenceFloor: 0.6,
}

// Bound the work so a large package can't blow up prompt volume or memory: at
// most this many files, each truncated to this many bytes before prompting.
const MAX_THREAT_FILES = 24
const MAX_FILE_BYTES = 64 * 1024

// Source extensions worth reading. A tarball ships built JS; TS is included for
// packages that publish sources.
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])

// Path/name red-flags that raise a file's scan priority: install-lifecycle
// entry points and the shapes malware hides behind.
const HIGH_SIGNAL_RE =
  /(?:^|\/)(?:post|pre)?install|(?:^|\/)(?:bootstrap|gyp|index|loader|setup)[.-]|\.min\.(?:c|m)?js$/i

// One staged package's manifest, only the fields that point at executable
// entry points.
export interface ThreatManifest {
  bin?: Record<string, string> | string | undefined
  main?: string | undefined
  scripts?: Record<string, string> | undefined
}

function manifestReferencedFiles(manifest: ThreatManifest): string[] {
  const cfg = { __proto__: null, ...manifest } as ThreatManifest
  const out: string[] = []
  if (typeof cfg.main === 'string' && cfg.main) {
    out.push(cfg.main)
  }
  if (typeof cfg.bin === 'string' && cfg.bin) {
    out.push(cfg.bin)
  } else if (cfg.bin && typeof cfg.bin === 'object') {
    const values = Object.values(cfg.bin)
    for (let i = 0, { length } = values; i < length; i += 1) {
      const value = values[i]!
      if (typeof value === 'string' && value) {
        out.push(value)
      }
    }
  }
  // A `scripts` value is a shell command, not a path, but a bare `node x.js`
  // form names a file worth reading; pull any token that looks like a path.
  if (cfg.scripts && typeof cfg.scripts === 'object') {
    const cmds = Object.values(cfg.scripts)
    for (let i = 0, { length } = cmds; i < length; i += 1) {
      const cmd = cmds[i]!
      if (typeof cmd !== 'string') {
        continue
      }
      const tokens = cmd.split(/\s+/)
      for (let j = 0, jn = tokens.length; j < jn; j += 1) {
        const token = tokens[j]!
        // A path-ish token ending in .js/.cjs/.mjs: the leading [./] requires a
        // relative or directory marker so a bare word (a flag, a bin name) skips.
        if (/[./].*\.(?:c|m)?js$/i.test(token)) {
          out.push(token.replace(/^\.\//, ''))
        }
      }
    }
  }
  return out
}

/**
 * Prioritize which of a tarball's files to scan. Pure over the file list plus
 * the manifest's executable entry points: `package.json` always, then every
 * manifest-referenced entry (main / bin / script-named file), then high-signal
 * code files (install hooks, loaders, minified blobs), then remaining code
 * files, deduped and capped at `MAX_THREAT_FILES`. Paths are normalized so the
 * selection is separator-stable across platforms.
 */
export function selectThreatFiles(
  entryNames: readonly string[],
  manifest: ThreatManifest = {},
): string[] {
  const files = entryNames
    .map(normalizePath)
    .map(p => p.replace(/^\.\//, '').replace(/^package\//, ''))
  const present = new Set(files)
  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string) => {
    const p = candidate.replace(/^\.\//, '').replace(/^package\//, '')
    if (present.has(p) && !seen.has(p)) {
      seen.add(p)
      ordered.push(p)
    }
  }
  add('package.json')
  for (const ref of manifestReferencedFiles(manifest)) {
    add(normalizePath(ref))
  }
  const isCode = (p: string) => CODE_EXTENSIONS.has(path.extname(p))
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = files[i]!
    if (isCode(p) && HIGH_SIGNAL_RE.test(p)) {
      add(p)
    }
  }
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = files[i]!
    if (isCode(p)) {
      add(p)
    }
  }
  return ordered.slice(0, MAX_THREAT_FILES)
}

/**
 * Build the per-file threat-triage prompt. Instructs the model to answer with
 * ONLY a JSON verdict object so `parseThreatVerdict` can harden it.
 */
export function buildThreatPrompt(relPath: string, contents: string): string {
  return [
    'You are a package-security triage analyst. Assess ONLY the file below for',
    'signs of malicious intent: install-hook abuse, network exfiltration,',
    "credential/env harvesting, obfuscated or dynamically-eval'd payloads,",
    'or a data-stealing postinstall. Benign code is "clean".',
    'Answer with ONLY a JSON object, no prose:',
    '{"verdict":"clean|suspicious|malicious","confidence":0..1,"reasons":["…"]}',
    '',
    `FILE: ${relPath}`,
    '```',
    contents,
    '```',
  ].join('\n')
}

/**
 * Harden a small model's reply into a verdict. Extracts the first JSON object
 * in the text, since a small model often wraps its JSON in prose, validates
 * the verdict enum and the confidence range, and defaults defensively: an
 * unparseable or off-enum reply is treated as `suspicious` at full confidence,
 * so a garbled answer fails closed rather than passing.
 */
export function parseThreatVerdict(text: string): {
  confidence: number
  reasons: string[]
  verdict: ThreatVerdict
} {
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        confidence?: unknown | undefined
        reasons?: unknown | undefined
        verdict?: unknown | undefined
      }
      const verdict =
        parsed.verdict === 'clean' ||
        parsed.verdict === 'malicious' ||
        parsed.verdict === 'suspicious'
          ? parsed.verdict
          : 'suspicious'
      const confidence =
        typeof parsed.confidence === 'number' &&
        parsed.confidence >= 0 &&
        parsed.confidence <= 1
          ? parsed.confidence
          : 1
      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === 'string')
        : []
      return { confidence, reasons, verdict }
    } catch {
      // Fall through to the fail-closed default.
    }
  }
  return {
    confidence: 1,
    reasons: ['unparseable model reply; treated as suspicious'],
    verdict: 'suspicious',
  }
}

/**
 * Pure policy evaluation: which findings block the publish. `malicious` and an
 * unevaluable `error` always block; `suspicious` blocks at/above the policy's
 * confidence floor.
 */
export function collectThreatFailures(
  findings: readonly ThreatFinding[],
  policy: ThreatPolicy = DEFAULT_THREAT_POLICY,
): ThreatFinding[] {
  const floor = policy.suspiciousConfidenceFloor
  return findings.filter(f => {
    if (f.verdict === 'error' || f.verdict === 'malicious') {
      return true
    }
    return f.verdict === 'suspicious' && f.confidence >= floor
  })
}

/**
 * Run the local threat scan over an extracted tarball directory. Probes the
 * on-device model once via the injected provider (default:
 * socket-lib's keyless `builtinLocalProvider`); when none resolves, returns
 * `available:false` and no findings so the caller decides the fail-closed
 * policy. Otherwise reads each selected file (truncated), prompts the model,
 * and collects a verdict per file. Every dependency — the provider, the file
 * reader, the manifest — is injectable so tests drive it with no model and no
 * disk.
 */
export async function runLocalThreatScan(
  packageDir: string,
  options?:
    | {
        listFiles?: ((dir: string) => Promise<string[]>) | undefined
        manifest?: ThreatManifest | undefined
        model?: string | undefined
        provider?: LocalAgentProvider | undefined
        readFile?: ((abs: string) => Promise<string>) | undefined
      }
    | undefined,
): Promise<ThreatScanResult> {
  const {
    listFiles = defaultListFiles,
    manifest,
    model,
    provider,
    readFile = defaultReadFile,
  } = { __proto__: null, ...options } as NonNullable<typeof options>

  const localProvider = provider ?? builtinLocalProvider()
  let availability: string
  try {
    availability = await localProvider.availability()
  } catch (e) {
    logger.warn(`Threat scan: local model probe failed (${errorMessage(e)}).`)
    return { available: false, findings: [] }
  }
  if (availability !== 'available') {
    logger.log(
      `Threat scan: no on-device model ready (availability: ${availability}); skipping.`,
    )
    return { available: false, findings: [] }
  }

  const entryNames = await listFiles(packageDir)
  const selected = selectThreatFiles(entryNames, manifest ?? {})
  const findings: ThreatFinding[] = []
  for (let i = 0, { length } = selected; i < length; i += 1) {
    const rel = selected[i]!
    // eslint-disable-next-line no-await-in-loop -- serial: one small-model prompt at a time keeps memory + a single-session engine sane.
    const contents = await readCapped(readFile, path.join(packageDir, rel))
    const prompt = buildThreatPrompt(rel, contents)
    // eslint-disable-next-line no-await-in-loop -- serial model generation.
    const result = await spawnLocalAgent(
      { cwd: packageDir, model, prompt },
      localProvider,
    )
    if (result.unavailable) {
      // The engine dropped out mid-run; report what we have and mark
      // unavailable so the caller fails closed on an incomplete scan.
      return { available: false, findings }
    }
    if (result.exitCode !== 0) {
      findings.push({
        confidence: 1,
        file: rel,
        reasons: [result.stderr || 'model generation failed'],
        verdict: 'error',
      })
      continue
    }
    const parsed = parseThreatVerdict(result.stdout)
    findings.push({
      confidence: parsed.confidence,
      file: rel,
      reasons: parsed.reasons,
      verdict: parsed.verdict,
    })
  }
  return { available: true, findings }
}

async function defaultListFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.readdir(path.join(dir, rel), {
      withFileTypes: true,
    })
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          // eslint-disable-next-line no-await-in-loop -- serial dir walk.
          await walk(childRel)
        }
      } else if (entry.isFile()) {
        out.push(childRel)
      }
    }
  }
  await walk('')
  return out
}

async function defaultReadFile(abs: string): Promise<string> {
  return await fs.readFile(abs, 'utf8')
}

async function readCapped(
  reader: (abs: string) => Promise<string>,
  abs: string,
): Promise<string> {
  try {
    const text = await reader(abs)
    return text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text
  } catch {
    return ''
  }
}

/**
 * Whether the caller asked for the local threat scan via argv/env.
 */
export function threatScanRequested(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes('--threat-scan') || env['SOCKET_THREAT_SCAN'] === '1'
}
