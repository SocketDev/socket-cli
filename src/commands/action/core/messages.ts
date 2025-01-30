import { Diff, Issue, Purl } from './classes'

export class Messages {
  // OK
  createSecurityCommentJSON({ diff }: { diff: Diff }) {
    let scanFailed = false

    if (diff.newAlerts.length === 0) {
      // TODO: unreachable code
      for (const alert of diff.newAlerts) {
        if (alert.error) {
          scanFailed = true
          break
        }
      }
    }

    const output: {
      scanFailed: boolean
      newAlerts: Issue[]
      fullScanId: string
    } = {
      scanFailed,
      newAlerts: [],
      fullScanId: diff.id
    }
    for (const alert of diff.newAlerts) {
      output.newAlerts.push(alert)
    }

    return output
  }

  // OK
  static createPurlLink(purl: Purl): string {
    const packageUrl = `[${purl.purl}](${purl.url})`
    return packageUrl
  }

  // OK
  static createAddedTable(diff: Diff): string {
    const overviewTable = [
      'Package',
      'Direct',
      'Capabilities',
      'Transitives',
      'Size',
      'Author'
    ]
    const rows = []
    for (const added of diff.newPackages) {
      const packageUrl = Messages.createPurlLink(added)
      const capabilities = added.capabilities.join(', ')
      const row = [
        packageUrl,
        added.direct,
        capabilities,
        added.transitives,
        `${added.size} KB`,
        added.author_url
      ]
      rows.push(row)
    }

    let md = ''
    md += `|${overviewTable.join('|')}|\n`
    md += '|---|---|---|---|---|---|\n'
    for (const row of rows) {
      md += `|${row.join('|')}|\n`
    }

    return md
  }

  // OK
  static createRemoveLine(diff: Diff): string {
    const removedLine = ['Removed packages:']
    for (const removed of diff.removedPackages) {
      const packageUrl = Messages.createPurlLink(removed)
      removedLine.push(packageUrl)
    }
    return removedLine.join(', ')
  }

  // OK
  static dependencyOverviewTemplate(diff: Diff): string {
    let md = ''
    md += '<!-- socket-overview-comment-actions -->\n'
    md += '# Socket Security: Dependency Overview\n'
    md +=
      'New and removed dependencies detected. Learn more about [socket.dev](https://socket.dev)\n\n'
    md += Messages.createAddedTable(diff)
    if (diff.removedPackages.length > 0) {
      md += Messages.createRemoveLine(diff)
    }
    return md
  }

  // OK
  static createSources(alert: Issue): [string, string] {
    const sources: string[] = []
    const manifests: string[] = []
    for (const [source, manifest] of alert.introduced_by) {
      const addStr = `<li>${manifest}</li>`
      const sourceStr = `<li>${source}</li>`
      if (!sources.includes(sourceStr)) {
        sources.push(sourceStr)
      }
      if (!manifests.includes(addStr)) {
        manifests.push(addStr)
      }
    }
    let manifestList = manifests.join('')
    let sourceList = sources.join('')
    const manifestStr = `<ul>${manifestList}</ul>`
    const sourcesStr = `<ul>${sourceList}</ul>`
    return [manifestStr, sourcesStr]
  }

  // OK
  static createSecurityAlertTable(diff: Diff): {
    ignoreCommands: string[]
    nextSteps: Record<string, string[]>
    mdTable: string
  } {
    const alertTable = [
      'Alert',
      'Package',
      'Introduced by',
      'Manifest File',
      'CI'
    ]
    const nextSteps: Record<string, string[]> = {}
    const ignoreCommands: string[] = []

    const rows: string[][] = []
    for (const alert of diff.newAlerts) {
      if (!(alert.next_step_title in nextSteps)) {
        nextSteps[alert.next_step_title] = [alert.description, alert.suggestion]
      }
      const ignore = `\`SocketSecurity ignore ${alert.purl}\``
      if (!ignoreCommands.includes(ignore)) {
        ignoreCommands.push(ignore)
      }
      const [manifestStr, sourceStr] = Messages.createSources(alert)
      const purlUrl = `[${alert.purl}](${alert.url})`
      if (alert.error) {
        alert.emoji = ':no_entry_sign:'
      } else {
        alert.emoji = ':warning:'
      }
      const row = [alert.title, purlUrl, sourceStr, manifestStr, alert.emoji]
      if (!rows.some(r => r.join() === row.join())) {
        rows.push(row)
      }
    }

    let md = ''
    md += `|${alertTable.join('|')}|\n`
    md += '|---|---|---|---|---|\n'
    for (const row of rows) {
      md += `|${row.join('|')}|\n`
    }

    return { ignoreCommands, nextSteps, mdTable: md }
  }

  // OK
  static createNextSteps(nextSteps: Record<string, string[]>): string {
    let md = ''
    for (const step in nextSteps) {
      const detail = nextSteps[step]!
      md += '<details>\n'
      md += `<summary>${step}</summary>\n`
      for (const line of detail) {
        md += `${line}\n`
      }
      md += '</details>\n'
    }
    return md
  }

  // OK
  static createDeeperLook(): string {
    let md = ''
    md += '<details>\n'
    md += '<summary>Take a deeper look at the dependency</summary>\n'
    md +=
      "Take a moment to review the security alert above. Review the linked package source code to understand the potential risk. Ensure the package is not malicious before proceeding. If you're unsure how to proceed, reach out to your security team or ask the Socket team for help at support [AT] socket [DOT] dev.\n"
    md += '</details>\n'
    return md
  }

  // OK
  static createRemovePackage(): string {
    let md = ''
    md += '<details>\n'
    md += '<summary>Remove the package</summary>\n'
    md +=
      'If you happen to install a dependency that Socket reports as [https://socket.dev/npm/issue/malware](Known Malware) you should immediately remove it and select a different dependency. For other alert types, you may may wish to investigate alternative packages or consider if there are other ways to mitigate the specific risk posed by the dependency.\n'
    md += '</details>\n'
    return md
  }

  // OK
  static createAcceptableRisk(ignoreCommands: string[]): string {
    let md = ''
    md += '<details>\n'
    md += '<summary>Mark a package as acceptable risk</summary>\n'
    md +=
      'To ignore an alert, reply with a comment starting with `SocketSecurity ignore` followed by a space separated list of `ecosystem/package-name@version` specifiers. e.g. `SocketSecurity ignore npm/foo@1.0.0` or ignore all packages with `SocketSecurity ignore-all`\n'
    md += '<ul>\n'
    for (const ignore of ignoreCommands) {
      md += `<li>${ignore}</li>\n`
    }
    md += '</ul>\n'
    md += '</details>\n'
    return md
  }

  // OK
  static securityCommentTemplate(diff: Diff): string {
    let md = ''
    md += '<!-- socket-security-comment-actions -->\n'
    md += '# Socket Security: Issues Report\n'
    md +=
      'Potential security issues detected. Learn more about [socket.dev](https://socket.dev)\n'
    md +=
      'To accept the risk, merge this PR and you will not be notified again.\n\n'
    md += '<!-- start-socket-alerts-table -->\n'
    const { ignoreCommands, nextSteps, mdTable } =
      Messages.createSecurityAlertTable(diff)
    md += mdTable
    md += '<!-- end-socket-alerts-table -->\n\n'
    md += Messages.createNextSteps(nextSteps)
    md += Messages.createDeeperLook()
    md += Messages.createRemovePackage()
    md += Messages.createAcceptableRisk(ignoreCommands)
    return md.trim()
  }
}
