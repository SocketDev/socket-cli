import { existsSync } from 'node:fs'
import path from 'node:path'

import { whichReal } from '@socketsecurity/lib-stable/bin/which'
import {
  BUN,
  NPM,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-stable/constants/agents'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { debugDirNs, debugNs } from '@socketsecurity/lib-stable/debug/output'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
// socket-lint: allow bare-semver -- lib-stable 6.0.9 doesn't publish ./external/semver; semver is bundled at build so no runtime dep leaks.
import semver from 'semver'

import { getNpmExecPath, getPnpmExecPath } from '../../constants/agents.mts'
import { FLAG_VERSION } from '../../constants/cli.mts'
import { execPath, nodeNoWarningsFlags } from '../../constants/paths.mts'
import { preferWindowsCmdShim, resolveBinPathSync } from './windows-shims.mts'

import type { Agent } from './supported-agents.mts'
import type { SemVer } from 'semver'

const binByAgent = new Map<Agent, string>([
  [BUN, BUN],
  [NPM, NPM],
  [PNPM, PNPM],
  [YARN_BERRY, YARN],
  [YARN_CLASSIC, YARN],
  [VLT, VLT],
])

export async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent.get(agent)!
  if (binName === NPM) {
    // Try to use getNpmExecPath() first, but verify it exists.
    const npmPath = preferWindowsCmdShim(await getNpmExecPath(), NPM)
    if (existsSync(npmPath)) {
      return npmPath
    }
    // If getNpmExecPath() doesn't exist, try common locations.
    // Check npm in the same directory as node.
    const nodeDir = path.dirname(process.execPath)
    /* c8 ignore start - WIN32-only branch and existsSync(npm-in-node-dir) hit; tests run on macOS/Linux against test fixtures, not a real node install dir */
    if (WIN32) {
      const npmCmdInNodeDir = path.join(nodeDir, `${NPM}.cmd`)
      if (existsSync(npmCmdInNodeDir)) {
        return npmCmdInNodeDir
      }
    }
    const npmInNodeDir = path.join(nodeDir, NPM)
    if (existsSync(npmInNodeDir)) {
      return preferWindowsCmdShim(npmInNodeDir, NPM)
    }
    /* c8 ignore stop */
    // Fall back to which.
    const whichRealResult = await whichReal(binName, { nothrow: true })
    return (
      (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
      binName
    )
  }
  if (binName === PNPM) {
    // Try to use getPnpmExecPath() first, but verify it exists.
    const pnpmPath = await getPnpmExecPath()
    if (existsSync(pnpmPath)) {
      return pnpmPath
    }
    // Fall back to which.
    const whichRealResult = await whichReal(binName, { nothrow: true })
    return (
      (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
      binName
    )
  }
  const whichRealResult = await whichReal(binName, { nothrow: true })
  return (
    (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
    binName
  )
}

export async function getAgentVersion(
  agent: Agent,
  agentExecPath: string,
  cwd: string,
): Promise<SemVer | undefined> {
  let result: SemVer | undefined
  const quotedCmd = `\`${agent} ${FLAG_VERSION}\``
  debugNs('stdio', `spawn: ${quotedCmd}`)
  try {
    let stdout: string

    // Some package manager "executables" may resolve to non-executable wrapper scripts
    // (e.g. the extensionless `npm` shim on Windows). Resolve the underlying entrypoint
    // and run it with Node when it is a JS file.
    let shouldRunWithNode: string | undefined = undefined
    /* c8 ignore start - WIN32-only branch for resolving JS shim entrypoints; tests run on macOS/Linux */
    if (WIN32) {
      try {
        const resolved = resolveBinPathSync(agentExecPath)
        const ext = path.extname(resolved).toLowerCase()
        if (ext === '.cjs' || ext === '.js' || ext === '.mjs') {
          shouldRunWithNode = resolved
        }
      } catch (e) {
        debugNs(
          'warn',
          `Failed to resolve bin path for ${agentExecPath}, falling back to direct spawn.`,
        )
        debugDirNs('error', e)
      }
    }

    if (shouldRunWithNode) {
      const spawnResult = await spawn(
        execPath,
        [...nodeNoWarningsFlags, shouldRunWithNode, FLAG_VERSION],
        { cwd },
      )

      if (!spawnResult) {
        return undefined
      }

      stdout = spawnResult.stdout
      /* c8 ignore stop */
    } else {
      const spawnResult = await spawn(agentExecPath, [FLAG_VERSION], {
        cwd,
        // On Windows, package managers are often .cmd files that require shell execution.
        // The spawn function from @socketsecurity/registry will handle this properly
        // when shell is true.
        shell: WIN32,
      })

      if (!spawnResult) {
        return undefined
      }

      stdout = spawnResult.stdout
    }

    result =
      // Coerce version output into a valid semver version by passing it through
      // semver.coerce which strips leading v's, carets (^), comparators (<,<=,>,>=,=),
      // and tildes (~).
      semver.coerce(stdout) ?? undefined
  } catch (e) {
    debugNs('error', `Package manager command failed: ${quotedCmd}`)
    debugDirNs('inspect', { cmd: quotedCmd })
    debugDirNs('error', e)
  }
  return result
}
