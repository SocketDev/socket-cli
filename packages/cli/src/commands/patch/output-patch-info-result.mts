import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdKeyValue } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchInfoData } from './handle-patch-info.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchInfoResult(
  result: CResult<PatchInfoData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const patch = result.data

  if (outputKind === 'markdown') {
    getDefaultLogger().log(`${mdHeader('Patch Information', 2)}\n`)
    getDefaultLogger().log(`${mdKeyValue('PURL', patch.purl)}\n`)
    if (patch.uuid) {
      getDefaultLogger().log(`${mdKeyValue('UUID', patch.uuid)}\n`)
    }
    getDefaultLogger().log(
      `${mdKeyValue('Description', patch.description || 'No description provided')}\n`,
    )
    getDefaultLogger().log(`${mdKeyValue('Exported', patch.exportedAt)}\n`)
    if (patch.tier) {
      getDefaultLogger().log(`${mdKeyValue('Tier', patch.tier)}\n`)
    }
    if (patch.license) {
      getDefaultLogger().log(`${mdKeyValue('License', patch.license)}\n`)
    }

    const fileCount = Object.keys(patch.files).length
    getDefaultLogger().log(`${mdHeader(`Files (${fileCount})`, 3)}\n`)
    for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
      getDefaultLogger().log(`**${fileName}**`)
      getDefaultLogger().log(`- Before: \`${fileInfo.beforeHash}\``)
      getDefaultLogger().log(`- After: \`${fileInfo.afterHash}\``)
      getDefaultLogger().log('')
    }

    if (patch.vulnerabilities) {
      const vulnCount = Object.keys(patch.vulnerabilities).length
      getDefaultLogger().log(
        `${mdHeader(`Vulnerabilities (${vulnCount})`, 3)}\n`,
      )
      for (const { 0: ghsaId, 1: vuln } of Object.entries(
        patch.vulnerabilities,
      )) {
        getDefaultLogger().log(`**${ghsaId}**`)
        if (vuln.cves && vuln.cves.length > 0) {
          getDefaultLogger().log(`- CVEs: ${vuln.cves.join(', ')}`)
        }
        if (vuln.severity) {
          getDefaultLogger().log(`- Severity: ${vuln.severity}`)
        }
        if (vuln.summary) {
          getDefaultLogger().log(`- Summary: ${vuln.summary}`)
        }
        if (vuln.description) {
          getDefaultLogger().log(`\n${vuln.description}`)
        }
        if (vuln.patchExplanation) {
          getDefaultLogger().log(
            `\n${mdKeyValue('Patch Explanation', vuln.patchExplanation)}`,
          )
        }
        getDefaultLogger().log('')
      }
    }
    return
  }

  // Default output.
  getDefaultLogger().group('')
  if (patch.uuid) {
    getDefaultLogger().log(`UUID: ${patch.uuid}`)
  }
  getDefaultLogger().log(
    `Description: ${patch.description || 'No description provided'}`,
  )
  getDefaultLogger().log(`Exported: ${patch.exportedAt}`)
  if (patch.tier) {
    getDefaultLogger().log(`Tier: ${patch.tier}`)
  }
  if (patch.license) {
    getDefaultLogger().log(`License: ${patch.license}`)
  }

  const fileCount = Object.keys(patch.files).length
  getDefaultLogger().log(
    `\nFiles (${fileCount} ${pluralize('file', { count: fileCount })}):`,
  )
  getDefaultLogger().group()
  for (const { 0: fileName, 1: fileInfo } of Object.entries(patch.files)) {
    getDefaultLogger().log(`- ${fileName}`)
    getDefaultLogger().group()
    getDefaultLogger().log(`Before: ${fileInfo.beforeHash}`)
    getDefaultLogger().log(`After:  ${fileInfo.afterHash}`)
    getDefaultLogger().groupEnd()
  }
  getDefaultLogger().groupEnd()

  if (patch.vulnerabilities) {
    const vulnCount = Object.keys(patch.vulnerabilities).length
    const vulnWord = vulnCount === 1 ? 'vulnerability' : 'vulnerabilities'
    getDefaultLogger().log(`\nVulnerabilities (${vulnCount} ${vulnWord}):`)
    getDefaultLogger().group()
    for (const { 0: ghsaId, 1: vuln } of Object.entries(
      patch.vulnerabilities,
    )) {
      getDefaultLogger().log(`- ${ghsaId}`)
      getDefaultLogger().group()
      if (vuln.cves && vuln.cves.length > 0) {
        getDefaultLogger().log(`CVEs: ${vuln.cves.join(', ')}`)
      }
      if (vuln.severity) {
        getDefaultLogger().log(`Severity: ${vuln.severity}`)
      }
      if (vuln.summary) {
        getDefaultLogger().log(`Summary: ${vuln.summary}`)
      }
      if (vuln.description) {
        getDefaultLogger().log('\nDescription:')
        getDefaultLogger().log(vuln.description)
      }
      if (vuln.patchExplanation) {
        getDefaultLogger().log('\nPatch Explanation:')
        getDefaultLogger().log(vuln.patchExplanation)
      }
      getDefaultLogger().groupEnd()
    }
    getDefaultLogger().groupEnd()
  }
  getDefaultLogger().groupEnd()
}
