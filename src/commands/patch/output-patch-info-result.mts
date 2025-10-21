import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'
import type { CResult, OutputKind } from '../../types.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import type { PatchInfoData } from './handle-patch-info.mts'

export async function outputPatchInfoResult(
  result: CResult<PatchInfoData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const patch = result.data

  if (outputKind === 'markdown') {
    logger.log('## Patch Information\n')
    logger.log(`**PURL**: ${patch.purl}\n`)
    if (patch.uuid) {
      logger.log(`**UUID**: ${patch.uuid}\n`)
    }
    logger.log(
      `**Description**: ${patch.description || 'No description provided'}\n`,
    )
    logger.log(`**Exported**: ${patch.exportedAt}\n`)
    if (patch.tier) {
      logger.log(`**Tier**: ${patch.tier}\n`)
    }
    if (patch.license) {
      logger.log(`**License**: ${patch.license}\n`)
    }

    const fileCount = Object.keys(patch.files).length
    logger.log(`### Files (${fileCount})\n`)
    for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
      logger.log(`**${fileName}**`)
      logger.log(`- Before: \`${fileInfo.beforeHash}\``)
      logger.log(`- After: \`${fileInfo.afterHash}\``)
      logger.log('')
    }

    if (patch.vulnerabilities) {
      const vulnCount = Object.keys(patch.vulnerabilities).length
      logger.log(`### Vulnerabilities (${vulnCount})\n`)
      for (const { 0: ghsaId, 1: vuln } of Object.entries(
        patch.vulnerabilities,
      )) {
        logger.log(`**${ghsaId}**`)
        if (vuln.cves && vuln.cves.length > 0) {
          logger.log(`- CVEs: ${vuln.cves.join(', ')}`)
        }
        if (vuln.severity) {
          logger.log(`- Severity: ${vuln.severity}`)
        }
        if (vuln.summary) {
          logger.log(`- Summary: ${vuln.summary}`)
        }
        if (vuln.description) {
          logger.log(`\n${vuln.description}`)
        }
        if (vuln.patchExplanation) {
          logger.log(`\n**Patch Explanation**: ${vuln.patchExplanation}`)
        }
        logger.log('')
      }
    }
    return
  }

  // Default output.
  logger.group('')
  if (patch.uuid) {
    logger.log(`UUID: ${patch.uuid}`)
  }
  logger.log(`Description: ${patch.description || 'No description provided'}`)
  logger.log(`Exported: ${patch.exportedAt}`)
  if (patch.tier) {
    logger.log(`Tier: ${patch.tier}`)
  }
  if (patch.license) {
    logger.log(`License: ${patch.license}`)
  }

  const fileCount = Object.keys(patch.files).length
  logger.log(
    `\nFiles (${fileCount} ${pluralize('file', { count: fileCount })}):`,
  )
  logger.group()
  for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
    logger.log(`- ${fileName}`)
    logger.group()
    logger.log(`Before: ${fileInfo.beforeHash}`)
    logger.log(`After:  ${fileInfo.afterHash}`)
    logger.groupEnd()
  }
  logger.groupEnd()

  if (patch.vulnerabilities) {
    const vulnCount = Object.keys(patch.vulnerabilities).length
    const vulnWord = vulnCount === 1 ? 'vulnerability' : 'vulnerabilities'
    logger.log(`\nVulnerabilities (${vulnCount} ${vulnWord}):`)
    logger.group()
    for (const { 0: ghsaId, 1: vuln } of Object.entries(
      patch.vulnerabilities,
    )) {
      logger.log(`- ${ghsaId}`)
      logger.group()
      if (vuln.cves && vuln.cves.length > 0) {
        logger.log(`CVEs: ${vuln.cves.join(', ')}`)
      }
      if (vuln.severity) {
        logger.log(`Severity: ${vuln.severity}`)
      }
      if (vuln.summary) {
        logger.log(`Summary: ${vuln.summary}`)
      }
      if (vuln.description) {
        logger.log('\nDescription:')
        logger.log(vuln.description)
      }
      if (vuln.patchExplanation) {
        logger.log('\nPatch Explanation:')
        logger.log(vuln.patchExplanation)
      }
      logger.groupEnd()
    }
    logger.groupEnd()
  }
  logger.groupEnd()
}
