/**
 * @file Registry-agnostic publish helpers: interactive + capturing process
 *   spawns, git introspection, first-JSON extraction from noisy CLI output,
 *   and the logger/root-path setup shared by every publish-infra module. A
 *   future cargo-publish flow reuses this tier verbatim; registry-specific
 *   helpers live in the per-registry subfolders (`npm/`).
 */

import { fstatSync, readFileSync } from 'node:fs'
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
  env?: NodeJS.ProcessEnv | undefined,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(cmd, args, {
      cwd,
      // Only override when the caller supplies one; absent = inherit.
      ...(env ? { env: { ...process.env, ...env } } : {}),
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
 * What a teed spawn returns: the exit code plus everything the child wrote,
 * stdout and stderr interleaved in arrival order.
 */
export interface TeedRun {
  code: number
  output: string
}

/**
 * Spawn a command, forward its output live, AND keep a copy.
 *
 * `runInherit` hands the child the parent's stdio, so the caller sees the
 * output but can never read it; `runCapture` reads stdout but silences it and
 * drops stderr entirely. A publish failure needs both halves — the operator
 * watches the stream in real time, and the failure handler has to inspect what
 * the registry actually said before it offers a diagnosis. Both streams are
 * accumulated into one buffer because the definitive error and its context
 * straddle them (pnpm logs `Skipped OIDC` and `[E401]` two lines apart).
 */
export function runInheritTee(
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv | undefined,
): Promise<TeedRun> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(cmd, args, {
      cwd,
      ...(env ? { env: { ...process.env, ...env } } : {}),
      shell: WIN32,
      // stdin stays inherited so an interactive prompt still reaches the user;
      // both output streams are piped so they can be teed.
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    // Same rejection swallow as runInherit — the exit code is the result here.
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? 0, output })
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
export function buildPtyInvocation(
  platform: NodeJS.Platform,
  cmd: string,
  args: readonly string[],
): { args: string[]; command: string } | undefined {
  if (platform === 'win32') {
    return undefined
  }
  if (platform === 'darwin') {
    // BSD script: `script -q /dev/null <cmd> <args…>` runs cmd directly.
    return { args: ['-q', '/dev/null', cmd, ...args], command: 'script' }
  }
  // util-linux script: the command goes through `-c` as a single shell
  // string — single-quote each arg (POSIX '\'' escape for embedded quotes).
  const quoted = [cmd, ...args]
    .map(a => `'${a.replace(/'/g, `'\\''`)}'`)
    .join(' ')
  return { args: ['-qec', quoted, '/dev/null'], command: 'script' }
}

// A PTY makes the child believe a human is watching, which is what keeps npm's
// browser web-OTP alive — but it also re-enables every spinner and redraw the
// child suppresses when piped. The Socket scan gate's progress display wrote
// 2.6 GB of frames into a captured PTY in ten minutes.
//
// Two obvious knobs are wrong here, both learned the hard way:
//   - `CI=1` — pnpm reads it as "no human here" and refuses the web-OTP
//     challenge, killing the interactivity the PTY exists to preserve.
//   - `TERM=dumb` — under script(1) it drives `process.stdout.columns` to 0,
//     and width-aware rendering dies on that before printing a line.
// NO_COLOR is the safe one: it strips the per-character truecolor escapes that
// made up the bulk of that 2.6 GB while leaving the terminal usable.
export const NON_INTERACTIVE_RENDER_ENV: NodeJS.ProcessEnv = {
  NO_COLOR: '1',
}

/**
 * True when fd 1 is a regular FILE (a `> out.log` redirect, or an agent harness
 * that captures a background task to disk) rather than a tty or a pipe.
 *
 * `script(1)` cannot drive a pseudo-terminal into a file-backed stdout: it
 * prints `tcgetattr/ioctl: Operation not supported on socket` and the child
 * exits 1 having produced NO output at all. That reads as "the command failed"
 * when the command never ran, which is worth naming rather than debugging
 * twice.
 */
export function stdoutIsFileBacked(): boolean {
  try {
    return fstatSync(1).isFile()
  } catch {
    return false
  }
}

export const PTY_FILE_STDOUT_MESSAGE =
  'stdout is a file — pumping the PTY through a pipe.\n' +
  '  What:  script(1) cannot allocate a pseudo-terminal onto a file-backed\n' +
  '         stdout, so the wrapper gives the PTY child a PIPE and pumps its\n' +
  '         output into the file itself. The browser web-OTP flow proceeds.\n' +
  '  Where: the PTY wrapper used for npm/pnpm browser web-OTP prompts.'

/**
 * The pipe-pump form of the PTY run: script(1) is happy writing to a pipe,
 * and the pump writes those bytes on to the file-backed stdout. This is how a
 * `> file` redirect or an agent harness capture still gets a working web-OTP
 * flow instead of a refusal — the 2026-07-29 odai approve hit exactly that.
 * Uses lib-stable spawn's enriched promise: `.process` exposes the child's
 * piped streams, so no raw child_process import is needed.
 */
export function runPtyPumped(
  pty: { command: string; args: readonly string[] },
  cwd: string,
  env?: NodeJS.ProcessEnv | undefined,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const childPromise = spawn(pty.command, [...pty.args], {
      cwd,
      ...(env ? { env: { ...process.env, ...env } } : {}),
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    // Same treatment as runInherit: the exit code resolves below, so the
    // enriched promise's non-zero rejection must be swallowed.
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.on('error', reject)
    child.on('exit', code => {
      resolve(code ?? 0)
    })
  })
}

export function runInheritTty(
  cmd: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv | undefined,
): Promise<number> {
  if (process.stdin.isTTY || WIN32) {
    return runInherit(cmd, args, cwd, env)
  }
  const pty = buildPtyInvocation(process.platform, cmd, args)
  if (!pty) {
    return runInherit(cmd, args, cwd, env)
  }
  if (stdoutIsFileBacked()) {
    logger.log(`[pty] ${PTY_FILE_STDOUT_MESSAGE}`)
    return runPtyPumped(pty, cwd, env)
  }
  return runInherit(pty.command, pty.args, cwd, env)
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
