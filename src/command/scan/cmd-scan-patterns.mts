import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { commonFlags } from '../../flags.mts'
import { defineFlags } from '../../meow.mts'
import { scanWithScannerPatterns } from '../../core/scanner-patterns/scan.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'

import type { ScannerName } from '@socketsecurity/scan-patterns'
import type { PatternSeverity } from '@socketsecurity/scan-patterns'
import type {
  CliCommandContext,
  CliSubcommand,
} from '../../util/cli/with-subcommands.mts'

const logger = getDefaultLogger()
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const

export function createScannerPatternCommand(
  commandName: string,
  scanner: ScannerName,
  description: string,
): CliSubcommand {
  const config = {
    commandName,
    description,
    flags: defineFlags({
      ...commonFlags,
      minimumSeverity: {
        type: 'string',
        default: 'info',
        description: 'Lowest finding severity to include',
      },
    }),
    help: (command: string) =>
      `${command} [path...]\n${getFlagListOutput(config.flags)}`,
    hidden: false,
  }
  return {
    description,
    hidden: false,
    async run(argv, importMeta, { parentName }: CliCommandContext) {
      const cli = meowOrExit({ argv, config, importMeta, parentName })
      const minimumSeverity = parseScannerPatternSeverity(
        cli.flags.minimumSeverity,
      )
      const result = await scanWithScannerPatterns(scanner, cli.input, {
        minimumSeverity,
      })
      if (cli.flags['json']) {
        logger.log(JSON.stringify(result, undefined, 2))
      } else {
        for (const finding of result.findings) {
          logger.log(
            `${finding.severity} ${finding.ruleId} ${finding.file}:${finding.line}:${finding.column} ${finding.title}`,
          )
        }
        logger.log(
          `Scanned ${result.filesScanned} files. Found ${result.findings.length} findings. ${result.unsupportedRules.length} rules are unsupported by this scanner.`,
        )
      }
      if (result.findings.length) {
        process.exitCode = 1
      }
    },
  }
}

export function parseScannerPatternSeverity(value: string): PatternSeverity {
  if (SEVERITIES.includes(value as PatternSeverity)) {
    return value as PatternSeverity
  }
  throw new Error(
    `Cannot select scanner severity. Where: --minimum-severity. Saw ${JSON.stringify(value)}; wanted critical, high, medium, low, or info. Fix: pass a supported severity.`,
  )
}
