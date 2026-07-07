/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { NPM, PNPM, YARN } from '@socketsecurity/lib-stable/constants/agents'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { FLAG_HELP } from '../../constants/cli.mjs'
import { NODE_MODULES } from '../../constants/packages.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/paths.mts'
import { spawnCdxgenDlx, spawnSynpDlx } from '../../util/dlx/spawn.mjs'
import { findUp } from '../../util/fs/find-up.mjs'
import { isYarnBerry } from '../../util/yarn/version.mts'

import type { DlxOptions, DlxSpawnResult } from '../../util/dlx/spawn.mjs'

const logger = getDefaultLogger()

// oxlint-disable-next-line socket/sort-set-args -- alphabetical; NPM and PNPM constants sit at their alphabetical positions.
const nodejsPlatformTypes = new Set([
  'javascript',
  'js',
  'nodejs',
  NPM,
  PNPM,
  'ts',
  'tsx',
  'typescript',
])

export type ArgvObject = {
  [key: string]: boolean | null | number | string | Array<string | number>
}

export function argvObjectToArray(argvObj: ArgvObject): string[] {
  if (argvObj['help']) {
    return [FLAG_HELP]
  }
  const result = []
  for (const { 0: key, 1: value } of Object.entries(argvObj)) {
    if (key === '_' || key === '--') {
      continue
    }
    if (key === 'babel' || key === 'install-deps' || key === 'validate') {
      // cdxgen documents no-babel, no-install-deps, and no-validate flags so
      // use them when relevant.
      result.push(`--${value ? key : `no-${key}`}`)
    } else if (value === true) {
      result.push(`--${key}`)
    } else if (typeof value === 'string') {
      result.push(`--${key}`, String(value))
    } else if (Array.isArray(value)) {
      result.push(`--${key}`, ...value.map(String))
    }
  }
  const pathArgs = argvObj['_'] as string[]
  if (Array.isArray(pathArgs)) {
    result.push(...pathArgs)
  }
  const argsAfterDoubleHyphen = argvObj['--'] as string[]
  if (Array.isArray(argsAfterDoubleHyphen)) {
    result.push('--', ...argsAfterDoubleHyphen)
  }
  return result
}

/**
 * Result of probing a cwd for Node.js SBOM inputs that cdxgen needs in the
 * default `pre-build` + `install-deps: false` mode.
 */
export type NodejsCdxgenSources = {
  hasLockfile: boolean
  hasNodeModules: boolean
}

/**
 * Probe upward from cwd for a recognized lockfile and for a co-located
 * `node_modules/` directory. cdxgen's `pre-build` lifecycle needs at least one
 * of these to produce a non-empty `components` array for a Node.js project.
 */
export async function detectNodejsCdxgenSources(
  cwd: string = process.cwd(),
): Promise<NodejsCdxgenSources> {
  const [pnpmLockPath, npmLockPath, yarnLockPath, nodeModulesPath] =
    await Promise.all([
      findUp(PNPM_LOCK_YAML, { cwd, onlyFiles: true }),
      findUp(PACKAGE_LOCK_JSON, { cwd, onlyFiles: true }),
      findUp(YARN_LOCK, { cwd, onlyFiles: true }),
      findUp(NODE_MODULES, { cwd, onlyDirectories: true }),
    ])
  return {
    hasLockfile: Boolean(npmLockPath || pnpmLockPath || yarnLockPath),
    hasNodeModules: Boolean(nodeModulesPath),
  }
}

/**
 * True when the argv `type` resolves to a Node.js platform (the cdxgen default
 * when the user does not pass `--type`).
 */
export function isNodejsCdxgenType(argvType: unknown): boolean {
  if (argvType === undefined || argvType === null) {
    return true
  }
  if (typeof argvType === 'string') {
    return nodejsPlatformTypes.has(argvType)
  }
  if (Array.isArray(argvType)) {
    return argvType.some(
      t => typeof t === 'string' && nodejsPlatformTypes.has(t),
    )
  }
  return false
}

export async function runCdxgen(argvObj: ArgvObject): Promise<DlxSpawnResult> {
  const argvMutable = { __proto__: null, ...argvObj } as ArgvObject

  const dlxOpts: DlxOptions = {
    stdio: 'inherit',
  }

  // Detect package manager based on lockfiles.
  const pnpmLockPath = await findUp(PNPM_LOCK_YAML, { onlyFiles: true })

  const npmLockPath = pnpmLockPath
    ? undefined
    : await findUp(PACKAGE_LOCK_JSON, { onlyFiles: true })

  const yarnLockPath =
    pnpmLockPath || npmLockPath
      ? undefined
      : await findUp(YARN_LOCK, { onlyFiles: true })

  const agent = pnpmLockPath ? PNPM : yarnLockPath && isYarnBerry() ? YARN : NPM

  let cleanupPackageLock = false
  if (
    yarnLockPath &&
    argvMutable['type'] !== YARN &&
    nodejsPlatformTypes.has(argvMutable['type'] as string)
  ) {
    // yarnLockPath is only resolved when neither pnpmLockPath nor npmLockPath
    // are set, so the only branch here is to use synp to create a
    // package-lock.json from the yarn.lock for a more accurate SBOM.
    try {
      const synpResult = await spawnSynpDlx(
        ['--source-file', `./${YARN_LOCK}`],
        {
          ...dlxOpts,
          agent,
        },
      )
      await synpResult.spawnPromise
      argvMutable['type'] = NPM
      cleanupPackageLock = true
    } catch {}
  }

  // Use appropriate package manager for cdxgen.
  const cdxgenResult = await spawnCdxgenDlx(argvObjectToArray(argvMutable), {
    ...dlxOpts,
    agent,
  })

  // Post-run cleanup + empty-BOM warning. We replace spawnPromise with a
  // chained promise so the caller's `await spawnPromise` also awaits this
  // work — otherwise the caller's continuation (e.g. `process.exit`) races
  // the first `await` inside the finally body and the warning never prints.
  const chainedSpawnPromise = cdxgenResult.spawnPromise.finally(async () => {
    if (cleanupPackageLock) {
      try {
        // This removes the temporary package-lock.json we created for cdxgen.
        // Using safeDeleteSync - no force needed since file is in cwd.
        safeDeleteSync(`./${PACKAGE_LOCK_JSON}`)
      } catch {}
    }

    const outputPath = argvMutable['output'] as string
    if (outputPath) {
      const cwd = process.cwd()
      const fullOutputPath = path.resolve(cwd, outputPath)
      // Validate that the resolved path is within the current working directory.
      // Normalize both paths to handle edge cases and ensure proper comparison.
      const normalizedOutput = path.normalize(fullOutputPath)
      const normalizedCwd = path.normalize(cwd)
      if (
        !normalizedOutput.startsWith(normalizedCwd + path.sep) &&
        normalizedOutput !== normalizedCwd
      ) {
        logger.error(
          `Output path "${outputPath}" resolves outside the current working directory`,
        )
        return
      }
      if (existsSync(fullOutputPath)) {
        logger.log(colors.cyanBright(`${outputPath} created!`))
        await warnIfEmptyComponents(fullOutputPath, argvMutable)
      }
    }
  })

  // Cast back to SpawnResult: .finally() returns plain Promise<T> which
  // drops the `process` / `stdin` extras SpawnResult carries. Callers of
  // runCdxgen only use `await spawnPromise` for the result, not those
  // extras, so the shape loss is safe.
  return {
    ...cdxgenResult,
    spawnPromise: chainedSpawnPromise as typeof cdxgenResult.spawnPromise,
  }
}

/**
 * Read a generated CycloneDX BOM and warn when its `components` array is empty.
 * An empty components array parses as valid CycloneDX but carries no dependency
 * data, so the Socket dashboard cannot surface alerts for it. This catches
 * configurations we did not hard-gate (non-default lifecycle, custom
 * `--filter`/`--only` wiping all components, ecosystem mismatch, etc.).
 */
export async function warnIfEmptyComponents(
  outputPath: string,
  argvMutable: ArgvObject,
): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(outputPath, 'utf8')
  } catch {
    return
  }
  let bom: { components?: unknown | undefined } | undefined
  try {
    bom = JSON.parse(raw)
  } catch {
    return
  }
  if (!bom || !Array.isArray(bom.components) || bom.components.length > 0) {
    return
  }
  const lifecycle = argvMutable['lifecycle']
  const lifecycleHint =
    lifecycle === 'pre-build' || lifecycle === undefined
      ? '  Pass --lifecycle build to resolve components during the build, or run a package install first so node_modules/ exists.\n'
      : '  Re-check --type, --filter, and --only — a filter may be excluding every component.\n'
  logger.warn(
    `${outputPath} has an empty "components" array — the generated SBOM contains no dependencies and the Socket dashboard will show no alerts for it.\n${lifecycleHint}`,
  )
}
