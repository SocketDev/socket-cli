import path from 'node:path'

import {
  isPatternTable,
  PATTERN_SEVERITY_ORDER,
  PATTERN_TABLE_SCHEMA_VERSION,
} from '@socketsecurity/scan-patterns'
import agentConfigsTable from '@socketsecurity/scan-patterns/data/agent-configs.json' with { type: 'json' }
import manifestsTable from '@socketsecurity/scan-patterns/data/manifests.json' with { type: 'json' }
import secretsTable from '@socketsecurity/scan-patterns/data/secrets.json' with { type: 'json' }
import skillsTable from '@socketsecurity/scan-patterns/data/skills.json' with { type: 'json' }
import workflowsTable from '@socketsecurity/scan-patterns/data/workflows.json' with { type: 'json' }
import {
  discoverScannerPatternFiles,
  readScannerPatternText,
} from './files.mts'

import type {
  PatternRule,
  PatternSeverity,
  PatternTable,
  ScannerName,
} from '@socketsecurity/scan-patterns'
import type {
  ScannerPatternFinding,
  ScannerPatternResult,
  ScannerPatternScanOptions,
} from './types.mts'

const TABLES: Readonly<Record<ScannerName, PatternTable>> = {
  agentConfigs: validateScannerPatternTable(agentConfigsTable, 'agentConfigs'),
  manifests: validateScannerPatternTable(manifestsTable, 'manifests'),
  secrets: validateScannerPatternTable(secretsTable, 'secrets'),
  skills: validateScannerPatternTable(skillsTable, 'skills'),
  workflows: validateScannerPatternTable(workflowsTable, 'workflows'),
}

export function compareScannerPatternFindings(
  left: ScannerPatternFinding,
  right: ScannerPatternFinding,
): number {
  return (
    PATTERN_SEVERITY_ORDER.indexOf(left.severity) -
      PATTERN_SEVERITY_ORDER.indexOf(right.severity) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.ruleId.localeCompare(right.ruleId)
  )
}

export function compileScannerPatternPathRegex(
  rule: PatternRule,
): RegExp | undefined {
  return rule.dialect === 'js' && rule.pathRegexSource
    ? new RegExp(rule.pathRegexSource, rule.regexFlags)
    : undefined
}

export function compileScannerPatternRegex(
  rule: PatternRule,
): RegExp | undefined {
  return rule.dialect === 'js' && rule.regexSource
    ? new RegExp(rule.regexSource, rule.regexFlags)
    : undefined
}

export function findScannerPatternMatches(
  rule: PatternRule,
  filename: string,
  content: string,
): ScannerPatternFinding[] {
  const pathRegex = compileScannerPatternPathRegex(rule)
  if (pathRegex && !pathRegex.test(filename)) {
    return []
  }
  if (
    rule.keywords.length &&
    !rule.keywords.some(keyword => content.includes(keyword))
  ) {
    return []
  }
  const compiled = compileScannerPatternRegex(rule)
  if (!compiled) {
    return []
  }
  const flags = compiled.flags.includes('g')
    ? compiled.flags
    : `${compiled.flags}g`
  const regex = new RegExp(compiled.source, flags)
  const findings: ScannerPatternFinding[] = []
  for (const match of content.matchAll(regex)) {
    const matchText = match[0]
    const entropyText =
      match
        .slice(1)
        .filter((capture): capture is string => Boolean(capture))
        .toSorted((left, right) => right.length - left.length)[0] ?? matchText
    if (
      !matchText ||
      (rule.entropy !== undefined &&
        scannerPatternEntropy(entropyText) < rule.entropy)
    ) {
      continue
    }
    const offset = match.index
    const prefix = content.slice(0, offset)
    findings.push({
      category: rule.category,
      column: offset - prefix.lastIndexOf('\n'),
      description: rule.description,
      file: filename,
      line: prefix.split(/\r?\n/).length,
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
    })
  }
  return findings
}

export function isExecutableScannerPatternRule(rule: PatternRule): boolean {
  return (
    rule.dialect === 'js' &&
    (rule.kind === 'path' || rule.kind === 'regex') &&
    typeof rule.regexSource === 'string'
  )
}

export function isScannerPatternSeverityEnabled(
  severity: PatternSeverity,
  minimumSeverity: PatternSeverity | undefined,
): boolean {
  return (
    !minimumSeverity ||
    PATTERN_SEVERITY_ORDER.indexOf(severity) <=
      PATTERN_SEVERITY_ORDER.indexOf(minimumSeverity)
  )
}

export function scannerPatternEntropy(value: string): number {
  if (!value.length) {
    return 0
  }
  const counts = new Map<string, number>()
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

export async function scanWithScannerPatterns(
  scanner: ScannerName,
  targets: readonly string[],
  options: ScannerPatternScanOptions = {},
): Promise<ScannerPatternResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const table = TABLES[scanner]
  const executableRules = table.rules.filter(isExecutableScannerPatternRule)
  const unsupportedRules = table.rules
    .filter(rule => !isExecutableScannerPatternRule(rule))
    .map(rule => ({
      __proto__: null,
      dialect: rule.dialect,
      id: rule.id,
      kind: rule.kind,
      title: rule.title,
    }))
  const files = await discoverScannerPatternFiles(scanner, targets, cwd)
  const findings: ScannerPatternFinding[] = []
  let filesScanned = 0
  for (
    let fileIndex = 0, { length } = files;
    fileIndex < length;
    fileIndex += 1
  ) {
    const filename = files[fileIndex]!
    const content = await readScannerPatternText(filename)
    if (content === undefined) {
      continue
    }
    filesScanned += 1
    const relativeFile = path.relative(cwd, filename) || path.basename(filename)
    for (
      let ruleIndex = 0, { length: ruleCount } = executableRules;
      ruleIndex < ruleCount;
      ruleIndex += 1
    ) {
      const rule = executableRules[ruleIndex]!
      if (
        !isScannerPatternSeverityEnabled(rule.severity, options.minimumSeverity)
      ) {
        continue
      }
      findings.push(...findScannerPatternMatches(rule, relativeFile, content))
    }
  }
  return {
    filesScanned,
    findings: findings.toSorted(compareScannerPatternFindings),
    scanner,
    unsupportedRules,
  }
}

export function validateScannerPatternTable(
  value: unknown,
  scanner: ScannerName,
): PatternTable {
  if (
    !isPatternTable(value) ||
    value.scanner !== scanner ||
    value.schemaVersion !== PATTERN_TABLE_SCHEMA_VERSION
  ) {
    throw new Error(
      `Cannot load scanner patterns. Where: ${scanner}. Saw an invalid table; wanted schema ${PATTERN_TABLE_SCHEMA_VERSION}. Fix: reinstall Socket CLI.`,
    )
  }
  return value
}
