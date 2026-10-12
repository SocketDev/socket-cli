import process from 'node:process'
import { parseArgs } from 'node:util'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { isMainModule } from '../../../../fleet/process/is-main-module.mts'
import { redactDiagnosticText } from '../diagnostic/redact.mts'
import { verifyNativePackage } from './check.mts'

const DESCRIPTION = 'verify an installed native package'
const HELP = [
  'Usage: node package-check.generated.mjs --package-root PATH --target TARGET [--json]',
  '',
  'Options:',
  '  --package-root PATH  Installed package directory to verify',
  '  --target TARGET      Native package target to verify',
  '  --json               Write a machine-readable result',
  '  --describe           Describe this verifier',
  '  --help               Show this help',
].join('\n')
const MAX_ERROR_LENGTH = 1200

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  let json = argv.includes('--json')
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        'package-root': { type: 'string' },
        target: { type: 'string' },
        json: { type: 'boolean' },
        describe: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    })
    const { values } = parsed
    json = values.json ?? false
    if (values.help) {
      process.stdout.write(`${HELP}\n`)
      return
    }
    if (values.describe) {
      process.stdout.write(
        values.json
          ? `${JSON.stringify({
              name: 'native-package-verifier',
              describe: DESCRIPTION,
            })}\n`
          : `${DESCRIPTION}\n`,
      )
      return
    }
    const packageRoot = values['package-root']
    const target = values.target
    if (!packageRoot || !target) {
      throw new Error('Pass both --package-root PATH and --target TARGET.')
    }
    const result = await verifyNativePackage({ packageRoot, target })
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
    } else {
      process.stdout.write(
        `Verified native package for ${result.requestedTarget} (launcher ${result.launcherTarget}).\n`,
      )
    }
  } catch (error) {
    const raw = errorMessage(error)
    const redacted = redactDiagnosticText(raw)
    const message =
      redacted.length > MAX_ERROR_LENGTH
        ? `${redacted.slice(0, MAX_ERROR_LENGTH)} [truncated]`
        : redacted
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
    } else {
      process.stderr.write(`Native package verification failed: ${message}\n`)
    }
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  void main()
}
