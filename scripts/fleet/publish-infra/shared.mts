/**
 * @file Registry-agnostic publish helpers: interactive + capturing process
 *   spawns, git introspection, first-JSON extraction from noisy CLI output,
 *   and the logger/root-path setup shared by every publish-infra module. A
 *   future cargo-publish flow reuses this tier verbatim; registry-specific
 *   helpers live in the per-registry subfolders (`npm/`).
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- streaming
// stdio required to forward `pnpm stage approve` 2FA prompts +
// `gh release create` upload progress. lib/spawn returns a Promise
// that resolves only on exit; here we need the live ChildProcess
// stream.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

export const logger = getDefaultLogger()
export const rootPath = REPO_ROOT

const WIN32 = process.platform === 'win32'

/**
 * The staged-to-approve handoff block, printed ONCE when a staging run
 * finishes. Two lines: the copy-pasteable command, anchored with `cd` at the
 * absolute repo it must run from (a staged package promoted from the wrong
 * checkout releases the wrong project), and one sentence naming what that
 * command owns so nobody re-derives it from the source. Pure — every staging
 * path shares this shape and a test asserts the text.
 */
export function formatApproveHandoff(
  approveCommand: string,
  ownership: string,
  repoPath: string = rootPath,
): string[] {
  return [`Next: cd ${repoPath} && ${approveCommand}`, ownership]
}

/**
 * Print `formatApproveHandoff`'s block through the publish logger.
 */
export function logApproveHandoff(
  approveCommand: string,
  ownership: string,
  repoPath: string = rootPath,
): void {
  const lines = formatApproveHandoff(approveCommand, ownership, repoPath)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    logger.log(lines[i]!)
  }
}

/**
 * Spawn a command and forward stdio (interactive). Returns the exit code. Used
 * when the user needs to see / interact with the live output stream
 * (publish/approve prompts, gh upload progress).
 */
export function runInherit(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(cmd, args, {
      cwd,
      shell: WIN32,
      stdio: 'inherit',
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit. We resolve with the exit code below, so swallow the
    // rejection (same treatment as runCapture) — otherwise a non-zero child
    // resolves the code here AND kills the process moments later with an
    // unhandled rejection.
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    child.on('error', reject)
    child.on('exit', code => {
      resolve(code ?? 0)
    })
  })
}

/**
 * Like runInherit, but guarantees the child sees a TTY. pnpm's registry
 * web-OTP challenge refuses non-interactive stdio
 * (ERR_PNPM_OTP_NON_INTERACTIVE) instead of opening the browser, so
 * agent-driven `pnpm stage approve` / `reject` calls wrap the command in
 * `script(1)`'s pseudo-terminal. Passthrough when stdio is already a TTY, and
 * on Windows (no script(1) there — Windows runs stay interactive-only).
 */
export function runInheritTty(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<number> {
  if (process.stdin.isTTY || WIN32) {
    return runInherit(cmd, args, cwd)
  }
  if (process.platform === 'darwin') {
    // BSD script: `script -q /dev/null <cmd> <args…>` runs cmd directly.
    return runInherit('script', ['-q', '/dev/null', cmd, ...args], cwd)
  }
  // util-linux script: the command goes through `-c` as a single shell
  // string — single-quote each arg (POSIX '\'' escape for embedded quotes).
  const quoted = [cmd, ...args]
    .map(a => `'${a.replace(/'/g, `'\\''`)}'`)
    .join(' ')
  return runInherit('script', ['-qec', quoted, '/dev/null'], cwd)
}

/**
 * Spawn a command and capture stdout. Stderr goes to the parent process's
 * stderr so error messages stay visible. Returns the collected stdout + exit
 * code. Used for one-shot queries (git, npm view, pnpm stage list --json).
 */
export function runCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(cmd, args, {
      cwd,
      shell: WIN32,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit. We resolve on exit-code below regardless, so swallow
    // the Promise rejection to avoid a process-killing unhandled rejection
    // when the spawned binary exits non-zero (e.g. `npm view <unpublished>`
    // returning 404 → exit 1, which is the documented signal for
    // `isAlreadyPublished` to return false).
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ stdout, code: code ?? 0 })
    })
  })
}

/**
 * Resolve `git rev-parse --short HEAD`. Returns the literal string `unknown`
 * when git fails (detached worktree, missing git, etc.) — callers that need a
 * guaranteed-valid SHA should check for that.
 */
export async function gitShortSha(cwd: string): Promise<string> {
  const { stdout, code } = await runCapture(
    'git',
    ['rev-parse', '--short', 'HEAD'],
    cwd,
  )
  if (code !== 0) {
    return 'unknown'
  }
  return stdout.trim()
}

/**
 * Extract the first balanced top-level `{ … }` JSON object from a
 * possibly-noisy stdout stream (pnpm wraps JSON output in progress lines that
 * aren't valid JSON themselves). Returns undefined if no balanced object
 * found.
 *
 * Used by npm-publish.mts to parse `pnpm stage list --json`.
 */
export function extractFirstJson(text: string): string | undefined {
  const startIdx = text.indexOf('{')
  if (startIdx === -1) {
    return undefined
  }
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx, { length } = text; i < length; i += 1) {
    const ch = text[i]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIdx, i + 1)
      }
    }
  }
  return undefined
}

/**
 * Whether this CI run may request npm provenance. The sigstore bundle is
 * verifiable only when the source repository is PUBLIC — npm rejects a
 * private-repo attestation with `E422 … Unsupported GitHub Actions source
 * repository visibility: "private"`. Reads the Actions event payload
 * (`repository.private` / `repository.visibility`); outside Actions, or when
 * the payload is unreadable, provenance stays OFF (fail-closed: a wrong
 * `--provenance` hard-fails the upload, a missing one only skips the
 * attestation). Logs the skip loudly so a private repo going public flips
 * provenance back on with zero config.
 */
export function provenanceAllowed(): boolean {
  if (process.env['GITHUB_ACTIONS'] !== 'true') {
    return false
  }
  const eventPath = process.env['GITHUB_EVENT_PATH']
  if (!eventPath) {
    return false
  }
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
      repository?:
        | {
            private?: boolean | undefined
            visibility?: string | undefined
          }
        | undefined
    }
    const repo = event.repository
    if (!repo) {
      return false
    }
    if (repo.visibility !== undefined) {
      return repo.visibility === 'public'
    }
    return repo.private === false
  } catch {
    return false
  }
}
