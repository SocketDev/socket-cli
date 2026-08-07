/**
 * @file Decision core for the fleet setup action, extracted from the inline
 *   bash of its "Install pnpm" and "Download sfw" steps. Three families of
 *   branch decisions live here, unchanged from the inline blocks and proven
 *   byte-identical old-vs-new side-by-side before extraction:
 *
 *   - tools-file schema: entries nest under `tools`, current schema, or sit at
 *     the top level, legacy flat, and sfw flavors are their own `sfw-<flavor>`
 *     entries (canonical — external-tools-schema.mts ToolEntry rejects nested
 *     flavor objects) or nest under one `sfw.{version,free,enterprise}` key
 *     (legacy). The probes SPAWN the sibling _shared/jq.mjs exactly the way the
 *     shell did — jq.mjs owns the key-walk and `extends`-chain semantics, so
 *     probing through it keeps a single source of truth. Entry paths come back
 *     space-joined and the call sites expand them unquoted (like $NS) so the
 *     legacy two-word path splits; on legacy files the version path is the
 *     shared `sfw version`, NOT `<entry path> version`.
 *   - sfw flavor selection: enterprise (SocketDev/firewall-release) when
 *     SOCKET_API_TOKEN is present, otherwise free (SocketDev/sfw-free); the
 *     enterprise-probe classification — transient 5xx (retry, then treat as a
 *     Socket-side outage) vs terminal SKU 403 (the token lacks the
 *     firewall-enterprise SKU) — and the free-fallback re-selection, where only
 *     the canonical shape re-reads a version, legacy shares one. An output
 *     matching BOTH shapes classifies as 5xx: the inline loop's 5xx grep ran
 *     first, so 5xx always outranked the SKU string.
 *   - extended-env gating, disabled-seam-pattern, fleet docs: the optional
 *     SOCKET_TOOL_* provenance exports emit only when EXTENDED_ENV=true; the
 *     load-bearing exports — SFW_BIN, SFW_IS_ENTERPRISE (with its
 *     enterprise-flag derivation), SFW_SILENT, and the SOCKET_API_TOKEN /
 *     SOCKET_API_KEY dual naming whenever a token is present — emit
 *     unconditionally, in the inline blocks' exact order. Pure decision
 *     functions are exported for the wheelhouse unit suite; the thin CLI shell
 *     at the bottom reads inputs from env and prints decisions to stdout — the
 *     step consumes single values via command substitution and appends the
 *     planned export lines to $GITHUB_ENV. Co-located with the action and
 *     invoked via $GITHUB_ACTION_PATH so it travels when a member consumes the
 *     action — same shape as github-status-check's probe-github-status.mjs and
 *     github-release's cut-immutable-release.mjs. Dependency-free on purpose:
 *     it runs on the runner's system Node before any install exists, so only
 *     `node:` builtins are used. Subcommands (inputs via env, decisions on
 *     stdout):
 *   - namespace: TOOLS_FILE → `tools` or an empty line.
 *   - select-sfw: TOOLS_FILE, SOCKET_API_TOKEN → six lines: namespace, shape,
 *     flavor, repo, version path, entry path.
 *   - fallback-sfw: SFW_SHAPE → four lines: flavor, repo, version path (empty =
 *     keep the already-read version), entry path.
 *   - classify-sfw-probe: SFW_PROBE_OUT → `5xx` | `sku` | `ok`.
 *   - pnpm-checksums-env: EXTENDED_ENV, TOOLS_DEST → 0-1 export lines.
 *   - pnpm-env: EXTENDED_ENV, PNPM_VERSION, PLATFORM, ASSET, INTEGRITY, PNPM_BIN,
 *     PNPM_DIR → 0 or 6 export lines.
 *   - sfw-env: EXTENDED_ENV, SOCKET_API_TOKEN, SFW_BIN, SFW_FLAVOR, SFW_VERSION,
 *     PLATFORM, ASSET, INTEGRITY → 3-10 export lines. The pnpm BOOTSTRAP path —
 *     taken only when TOOLS_FILE is absent (a thin member's payload has not
 *     materialized yet) — is a separate decision core in the co-located
 *     bootstrap-pnpm.mjs; see that file's header.
 */

// composite-action helper runs on the raw runner before setup-node;
// node_modules is unavailable and the jq.mjs probe is naturally sync.
// oxlint-disable-next-line socket/prefer-async-spawn -- sync jq probe
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Namespace decision: the tools file nests entries under `tools` (current
 * schema) or at the top level, legacy flat. `hasToolsKey` is the probe
 * result for the top-level `tools` key; an empty namespace splits away
 * unquoted at the jq call sites.
 */
export function toolsNamespace(hasToolsKey) {
  return hasToolsKey ? 'tools' : ''
}

/**
 * Shape decision: canonical files carry per-flavor `sfw-free` /
 * `sfw-enterprise` entries; legacy flat files nest both flavors under one
 * `sfw` key. `hasCanonicalEntry` is the probe result for
 * `[namespace] sfw-free version`.
 */
export function sfwShape(hasCanonicalEntry) {
  return hasCanonicalEntry ? 'canonical' : 'legacy'
}

/**
 * Flavor selection: enterprise when SOCKET_API_TOKEN is set, otherwise free.
 * Enterprise downloads from the private firewall-release repo are auth'd via
 * GITHUB_TOKEN inside install-tool.mjs.
 */
export function selectSfwFlavor(socketApiToken) {
  return socketApiToken
    ? { flavor: 'enterprise', repo: 'SocketDev/firewall-release' }
    : { flavor: 'free', repo: 'SocketDev/sfw-free' }
}

/**
 * The jq key path of the active flavor's entry — space-joined, expanded
 * unquoted at the call sites so the legacy two-word path splits.
 */
export function sfwEntryPath(shape, flavor) {
  return shape === 'canonical' ? `sfw-${flavor}` : `sfw ${flavor}`
}

/**
 * The jq key path of the active flavor's version. Canonical entries carry
 * per-flavor versions; legacy files share one `sfw.version` across flavors.
 */
export function sfwVersionPath(shape, flavor) {
  return shape === 'canonical' ? `sfw-${flavor} version` : 'sfw version'
}

/**
 * The whole front-half selection for the Download-sfw step: probe the
 * namespace and shape through jq.mjs, pick the flavor from the token, and
 * derive the entry/version paths. `probe(toolsFile, keys)` is injectable so
 * the unit suite can drive it without spawning.
 */
export function resolveSfwSelection({ probe, socketApiToken, toolsFile }) {
  const ns = toolsNamespace(probe(toolsFile, ['tools']))
  const nsKeys = ns === '' ? [] : [ns]
  const shape = sfwShape(probe(toolsFile, [...nsKeys, 'sfw-free', 'version']))
  const { flavor, repo } = selectSfwFlavor(socketApiToken)
  return {
    entryPath: sfwEntryPath(shape, flavor),
    flavor,
    ns,
    repo,
    shape,
    versionPath: sfwVersionPath(shape, flavor),
  }
}

/**
 * The free-flavor re-selection after an enterprise probe fallback. An empty
 * versionPath means keep the already-read version: canonical entries carry
 * per-flavor versions so the free one must be re-read, while legacy files
 * share one version across flavors.
 */
export function fallbackSfwSelection(shape) {
  return {
    entryPath: sfwEntryPath(shape, 'free'),
    flavor: 'free',
    repo: 'SocketDev/sfw-free',
    versionPath: shape === 'canonical' ? sfwVersionPath(shape, 'free') : '',
  }
}

/**
 * Classify one `sfw --version` probe output. 5xx shapes seen in the wild:
 * "Socket API returned status code 503", sfw stdout, and "validation got
 * status of 503" (setup-and-install). `sku` is the terminal 403 "Error while
 * identifying active SKUs" refusal — the token lacks the firewall-enterprise
 * SKU. 5xx is checked FIRST, exactly like the inline loop where the 5xx grep
 * decided retry before the SKU grep ever ran, so an output matching both
 * strings retries as a 5xx. Anything else — clean version output, hostname
 * resolution failure — is `ok` and takes the post-probe branches.
 */
export function classifySfwProbe(probeOutput) {
  if (/status (code|of) 5[0-9][0-9]/.test(probeOutput)) {
    return '5xx'
  }
  if (probeOutput.includes('identifying active SKUs')) {
    return 'sku'
  }
  return 'ok'
}

/**
 * The gated SOCKET_TOOL_CHECKSUMS_FILE pointer (disabled-seam: the staged
 * copy at TOOLS_DEST is unconditional; only this env-var pointer — which no
 * load-bearing step reads — is off unless a consumer opts in).
 */
export function planChecksumsEnvExports({ extendedEnv, toolsDest }) {
  return extendedEnv === 'true'
    ? [`SOCKET_TOOL_CHECKSUMS_FILE=${toolsDest}`]
    : []
}

/**
 * The gated pnpm provenance exports (disabled-seam: pnpm is already on
 * $GITHUB_PATH — the load-bearing wire-in — so these have no required
 * consumer).
 */
export function planPnpmEnvExports({
  asset,
  extendedEnv,
  integrity,
  platform,
  pnpmBin,
  pnpmDir,
  version,
}) {
  if (extendedEnv !== 'true') {
    return []
  }
  return [
    `SOCKET_TOOL_PNPM_VERSION=${version}`,
    `SOCKET_TOOL_PNPM_PLATFORM=${platform}`,
    `SOCKET_TOOL_PNPM_ASSET=${asset}`,
    `SOCKET_TOOL_PNPM_INTEGRITY=${integrity}`,
    `SOCKET_TOOL_PNPM_BIN=${pnpmBin}`,
    `SOCKET_TOOL_PNPM_DIR=${pnpmDir}`,
  ]
}

/**
 * The Download-sfw step's whole GITHUB_ENV plan, in the inline block's exact
 * order:
 *
 * - The API token under BOTH names whenever it is present — not only in the
 *   enterprise branch. SOCKET_API_TOKEN is canonical; SOCKET_API_KEY is the
 *   same value under the name the dev-machine OS keychain stores, so CI and
 *   local expose the identical var name (the only sanctioned CI-vs-local
 *   difference is the transport: secret-env in CI, keychain locally).
 * - SFW_BIN + SFW_IS_ENTERPRISE are load-bearing (external steps run `[ -x
 *   "$SFW_BIN" ]`; the Create-shims step reads SFW_IS_ENTERPRISE cross-step) —
 *   always exported, with SFW_IS_ENTERPRISE derived from the FINAL flavor,
 *   after any fallback. SFW_SILENT keeps the firewall's stdout banners out of
 *   every wrapped command — scripts that parse a tool's stdout (pack --json,
 *   the format pipe) would otherwise ingest banner lines as data.
 * - The SOCKET_TOOL_SFW_* provenance has no required consumer;
 *   disabled-seam-gated off unless extended-env opts in.
 */
export function planSfwEnvExports({
  asset,
  extendedEnv,
  flavor,
  integrity,
  platform,
  sfwBin,
  socketApiToken,
  version,
}) {
  const lines = []
  if (socketApiToken) {
    lines.push(
      `SOCKET_API_TOKEN=${socketApiToken}`,
      `SOCKET_API_KEY=${socketApiToken}`,
    )
  }
  lines.push(
    `SFW_BIN=${sfwBin}`,
    `SFW_IS_ENTERPRISE=${flavor === 'enterprise'}`,
    'SFW_SILENT=true',
  )
  if (extendedEnv === 'true') {
    lines.push(
      `SOCKET_TOOL_SFW_FLAVOR=${flavor}`,
      `SOCKET_TOOL_SFW_VERSION=${version}`,
      `SOCKET_TOOL_SFW_PLATFORM=${platform}`,
      `SOCKET_TOOL_SFW_ASSET=${asset}`,
      `SOCKET_TOOL_SFW_INTEGRITY=${integrity}`,
    )
  }
  return lines
}

// The default probe: spawn the sibling _shared/jq.mjs exactly the way the
// inline shell did (`node "$JQ" "$TOOLS_FILE" <keys…> >/dev/null 2>&1`) so
// the key-walk and `extends`-chain semantics stay single-sourced there. Any
// non-zero exit — missing key, empty value, unreadable file — reads as
// "absent", the `|| NS=""` shape the shell used.
function defaultProbe(toolsFile, keys) {
  const jq = fileURLToPath(new URL('../_shared/jq.mjs', import.meta.url))
  const r = spawnSync(process.execPath, [jq, toolsFile, ...keys], {
    stdio: 'ignore',
  })
  return r.status === 0
}

function env(name) {
  return process.env[name] ?? ''
}

// Each decided line is emitted `line\n`, matching the inline `echo`s — an
// empty plan appends zero bytes to $GITHUB_ENV.
function printLines(lines) {
  process.stdout.write(lines.map(line => `${line}\n`).join(''))
}

function main() {
  const subcommand = process.argv[2]
  switch (subcommand) {
    case 'namespace': {
      printLines([toolsNamespace(defaultProbe(env('TOOLS_FILE'), ['tools']))])
      return 0
    }
    case 'select-sfw': {
      const s = resolveSfwSelection({
        probe: defaultProbe,
        socketApiToken: env('SOCKET_API_TOKEN'),
        toolsFile: env('TOOLS_FILE'),
      })
      printLines([s.ns, s.shape, s.flavor, s.repo, s.versionPath, s.entryPath])
      return 0
    }
    case 'fallback-sfw': {
      const s = fallbackSfwSelection(env('SFW_SHAPE'))
      printLines([s.flavor, s.repo, s.versionPath, s.entryPath])
      return 0
    }
    case 'classify-sfw-probe': {
      printLines([classifySfwProbe(env('SFW_PROBE_OUT'))])
      return 0
    }
    case 'pnpm-checksums-env': {
      printLines(
        planChecksumsEnvExports({
          extendedEnv: env('EXTENDED_ENV'),
          toolsDest: env('TOOLS_DEST'),
        }),
      )
      return 0
    }
    case 'pnpm-env': {
      printLines(
        planPnpmEnvExports({
          asset: env('ASSET'),
          extendedEnv: env('EXTENDED_ENV'),
          integrity: env('INTEGRITY'),
          platform: env('PLATFORM'),
          pnpmBin: env('PNPM_BIN'),
          pnpmDir: env('PNPM_DIR'),
          version: env('PNPM_VERSION'),
        }),
      )
      return 0
    }
    case 'sfw-env': {
      printLines(
        planSfwEnvExports({
          asset: env('ASSET'),
          extendedEnv: env('EXTENDED_ENV'),
          flavor: env('SFW_FLAVOR'),
          integrity: env('INTEGRITY'),
          platform: env('PLATFORM'),
          sfwBin: env('SFW_BIN'),
          socketApiToken: env('SOCKET_API_TOKEN'),
          version: env('SFW_VERSION'),
        }),
      )
      return 0
    }
    default: {
      process.stderr.write(
        `× plan-setup-tools.mjs: unknown subcommand "${subcommand ?? ''}".\n`,
      )
      return 1
    }
  }
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile, the
// same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined.
function isEntrypoint(invokedPath) {
  if (!invokedPath) {
    return false
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) {
  process.exitCode = main()
}
