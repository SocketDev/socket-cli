import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from '../../../fleet/process/is-main-module.mts'
import { runMain } from '../../../fleet/process/main/run.mts'
import { redactDiagnosticText } from './diagnostic/redact.mts'
import {
  SEA_ENTRYPOINT_PATHS,
  SEA_PAYLOAD_PATH,
  SEA_RECEIPT_PATH,
  seaBinaryPath,
} from './paths.mts'
import { resolveSeaTarget, SEA_TARGETS } from './targets.mts'

const logger = getDefaultLogger()
const MAX_SMOKE_OUTPUT_CHARS = 4000
const DARWIN_DIAGNOSTIC_TIMEOUT_MS = 10_000

export async function collectDarwinCrashDiagnostic(
  binary: string,
  options: { spawnProcess?: typeof spawn | undefined } = {},
): Promise<string> {
  if (process.platform !== 'darwin') {
    return ''
  }
  try {
    const result = await (options.spawnProcess ?? spawn)(
      'lldb',
      [
        '--no-lldbinit',
        '-b',
        '-o',
        'run',
        '-k',
        'bt all',
        '-o',
        'quit',
        '--',
        binary,
        '--version',
      ],
      {
        stdio: 'pipe',
        throws: false,
        timeout: DARWIN_DIAGNOSTIC_TIMEOUT_MS,
      },
    )
    return (
      formatNativeSmokeOutput('lldb stdout', result.stdout) +
      formatNativeSmokeOutput('lldb stderr', result.stderr)
    )
  } catch {
    return '\nLLDB diagnostic unavailable.'
  }
}

export function formatNativeSmokeOutput(
  label: string,
  value: string | Buffer,
): string {
  const output = redactDiagnosticText(value.toString()).trim()
  if (!output) {
    return ''
  }
  const excerpt =
    output.length > MAX_SMOKE_OUTPUT_CHARS
      ? `[${output.length - MAX_SMOKE_OUTPUT_CHARS} characters omitted]\n${output.slice(-MAX_SMOKE_OUTPUT_CHARS)}`
      : output
  return `\n${label}:\n${excerpt}`
}

export async function main(): Promise<void> {
  const receipt = await readSeaReceipt()
  await verifySeaPayloadAndEntrypoints(receipt)
  const host = resolveSeaTarget(process.platform, process.arch, {
    glibc: (
      process.report.getReport() as {
        header: { glibcVersionRuntime?: string | undefined }
      }
    ).header.glibcVersionRuntime,
  })
  const { executionTarget, targets } = selectSeaTargets(host, process.argv)
  await verifySeaBinaryDigests(targets, receipt)
  await runSeaSmokeTests(executionTarget)
  if (process.argv.includes('--json')) {
    logger.stdout.write(JSON.stringify({ ok: true, targets }) + '\n')
  } else {
    logger.log(
      `Verified ${targets.length} native artifact(s) and executed ${executionTarget}.`,
    )
  }
}

async function readSeaReceipt(): Promise<{
  payload: string
  binaries: Record<string, string>
  entrypoints: Record<string, string>
}> {
  return JSON.parse(await readFile(SEA_RECEIPT_PATH, 'utf8')) as {
    payload: string
    binaries: Record<string, string>
    entrypoints: Record<string, string>
  }
}

async function verifySeaPayloadAndEntrypoints(receipt: {
  payload: string
  entrypoints: Record<string, string>
}): Promise<void> {
  const payload = crypto
    .createHash('sha256')
    .update(await readFile(SEA_PAYLOAD_PATH))
    .digest('hex')
  if (receipt.payload !== payload) {
    throw new Error(
      'Native binary payload does not match the CLI build. Run pnpm run build:native.',
    )
  }
  for (const [name, file] of Object.entries(SEA_ENTRYPOINT_PATHS)) {
    const actual = crypto
      .createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
    if (receipt.entrypoints[name] !== actual) {
      throw new Error(
        `Native binary entry point mismatch for ${name}. Run pnpm run build:native.`,
      )
    }
  }
}

function selectSeaTargets(
  host: string,
  args: readonly string[],
): { executionTarget: string; targets: readonly string[] } {
  const requested = args
    .find(value => value.startsWith('--target='))
    ?.slice('--target='.length)
  if (requested === '') {
    throw new Error(
      'Invalid native target. Pass a supported target after --target=.',
    )
  }
  if (requested && !SEA_TARGETS.some(target => target === requested)) {
    throw new Error(
      `Invalid native target ${requested}. Use one of ${SEA_TARGETS.join(', ')}.`,
    )
  }
  if (requested && args.includes('--host')) {
    throw new Error('Use either --host or --target, not both.')
  }
  const executionTarget = requested ?? host
  const targets = requested
    ? [requested]
    : args.includes('--host')
      ? [host]
      : SEA_TARGETS
  return { executionTarget, targets }
}

async function verifySeaBinaryDigests(
  targets: readonly string[],
  receipt: { binaries: Record<string, string> },
): Promise<void> {
  for (const target of targets) {
    const bytes = await readFile(seaBinaryPath(target))
    const actual = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actual !== receipt.binaries[target]) {
      throw new Error(
        `Native package digest mismatch for ${target}. Run pnpm run build:native.`,
      )
    }
  }
}

async function runSeaSmokeTests(executionTarget: string): Promise<void> {
  for (const args of [['--version'], ['--help'], ['npm', '--version']]) {
    const result = await spawn(seaBinaryPath(executionTarget), args, {
      stdio: 'pipe',
      throws: false,
      timeout: 60_000,
    })
    if (result.code !== 0 || !result.stdout.toString().trim()) {
      const diagnostic = await collectDarwinCrashDiagnostic(
        seaBinaryPath(executionTarget),
      )
      throw new Error(
        `Native binary smoke test failed for ${executionTarget} ${args.join(' ')} (exit ${result.code}, signal ${result.signal ?? 'none'}).` +
          formatNativeSmokeOutput('stdout', result.stdout) +
          formatNativeSmokeOutput('stderr', result.stderr) +
          diagnostic +
          '\nRebuild the executable.',
      )
    }
  }
}

const SCRIPT_META = {
  describe: 'verify socket native artifact integrity and execution',
  heavyJob: 'test' as const,
  help: 'Usage: pnpm run check:native-package [--host|--target=TARGET]',
  json: 'native' as const,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
