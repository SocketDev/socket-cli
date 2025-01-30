// https://github.com/SocketDev/socket-python-cli/blob/6d4fc56faee68d3a4764f1f80f84710635bdaf05/socketsecurity/core/__init__.py
/* eslint-disable no-await-in-loop */
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

import ndjson from 'ndjson'

import { SocketSdk } from '@socketsecurity/sdk'

import { Diff, FullScan, Issue, Package, Purl } from './classes'

import type { components, operations } from '@socketsecurity/sdk/types/api.d.ts'

export class Core {
  socket: SocketSdk
  owner: string
  repo: string
  files: string[]
  securityPolicy: Record<
    string,
    { action: 'error' | 'ignore' | 'warn' | 'monitor' }
  > = {}

  constructor({
    owner,
    repo,
    socket
  }: Pick<Core, 'socket' | 'owner' | 'repo' | 'files'>) {
    this.socket = socket
    this.owner = owner
    this.repo = repo
    this.files = []
  }

  async getSbomData({
    fullScanId
  }: {
    fullScanId: string
  }): Promise<components['schemas']['SocketArtifact'][]> {
    const orgFullScanResponse = await this.socket.getOrgFullScan(
      this.owner,
      fullScanId,
      undefined
    )
    if (!orgFullScanResponse.success) {
      return []
    }

    const { data: readStream }: { data: any } = orgFullScanResponse
    const sbomArtifacts: any = []

    readStream
      .pipe(ndjson.parse())
      .on('data', (sbomArtifact: any) => sbomArtifacts.push(sbomArtifact))

    await once(readStream, 'end')

    return sbomArtifacts
  }

  async createFullScan({
    params
  }: {
    params: Omit<operations['CreateOrgFullScan']['parameters']['query'], 'repo'>
  }): Promise<FullScan> {
    const orgFullScanResponse = await this.socket.createOrgFullScan(
      this.owner,
      // Ignoring because pull_request is of type number but URLSearchParams will convert it to a string
      // @ts-ignore
      new URLSearchParams({ repo: this.repo, ...params }),
      this.files
    )

    if (!orgFullScanResponse.success) {
      return new FullScan()
    }

    const { id: fullScanId } = orgFullScanResponse.data
    const fullScan = new FullScan(orgFullScanResponse.data)
    if (fullScanId !== undefined) {
      fullScan.sbom_artifacts = await this.getSbomData({ fullScanId })
    }
    return fullScan
  }

  getSourceData({
    packages,
    pkg
  }: {
    pkg: Package
    packages: Record<string, Package>
  }): [string, string][] {
    const introducedBy: [string, string][] = []

    if (pkg.direct) {
      let manifests = pkg.manifestFiles.map(({ file }) => file).join(';')

      introducedBy.push(['direct', manifests])
    } else {
      for (const topId of pkg.topLevelAncestors) {
        const topPackage = packages[topId]

        if (!topPackage) {
          continue
        }

        const topPurl = `${topPackage.type}/${topPackage.name}@${topPackage.version}`
        let manifests = topPackage.manifestFiles
          .map(({ file }) => file)
          .join(';')

        introducedBy.push([topPurl, manifests])
      }
    }

    return introducedBy
  }

  createPurl({
    packageId,
    packages
  }: {
    packageId: string
    packages: Record<string, Package>
  }): { purl: Purl; pkg: Package } {
    const pkg = packages[packageId]!
    const introducedBy = this.getSourceData({ pkg, packages })
    const purl = new Purl({
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      ecosystem: pkg.type,
      direct: pkg.direct,
      introduced_by: introducedBy,
      author: pkg.author,
      size: pkg.size,
      transitives: pkg.transitives,
      url: pkg.url,
      purl: pkg.purl
    })
    return { purl, pkg }
  }

  async createIssueAlerts({
    alerts,
    packages,
    pkg
  }: {
    pkg: Package
    alerts: Record<string, Issue[]>
    packages: Record<string, Package>
  }): Promise<Record<string, Issue[]>> {
    const issues = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, 'issues.json'), 'utf8')
    ) as Record<string, Record<string, string>>

    for (const alert of pkg.alerts) {
      const issue = issues[alert.type]

      let description = ''
      let title = ''
      let suggestion = ''
      let nextStepTitle = ''

      if (issue !== undefined) {
        description = issue['description'] ?? ''
        title = issue['title'] ?? ''
        suggestion = issue['suggestion'] ?? ''
        nextStepTitle = issue['nextStepTitle'] ?? ''
      }

      const introducedBy = this.getSourceData({ pkg, packages })

      const issueAlert = new Issue({
        pkg_type: pkg.type,
        pkg_name: pkg.name,
        pkg_version: pkg.version,
        pkg_id: pkg.id,
        type: alert.type,
        severity: alert.severity,
        key: alert.key,
        props: alert.props,
        description,
        title,
        suggestion,
        next_step_title: nextStepTitle,
        introduced_by: introducedBy,
        purl: pkg.purl,
        url: pkg.url,
        error: false,
        ignore: false,
        warn: false,
        monitor: false
      })

      if (alert.type in this.securityPolicy) {
        const action = this.securityPolicy[alert.type]?.action
        if (action !== undefined) {
          issueAlert[action] = true
        }
      }

      if (issueAlert.type !== 'licenseSpdxDisj') {
        if (!(issueAlert.key in alerts)) {
          alerts[issueAlert.key] = [issueAlert]
        } else {
          alerts[issueAlert.key]!.push(issueAlert)
        }
      }
    }

    return alerts
  }

  compareIssueAlerts({
    alerts,
    headScanAlerts,
    newScanAlerts
  }: {
    newScanAlerts: Record<string, Issue[]>
    headScanAlerts: Record<string, Issue[]>
    alerts: Issue[]
  }) {
    const consolidatedAlerts = new Set()

    for (const alertKey in newScanAlerts) {
      if (!(alertKey in headScanAlerts)) {
        const newAlerts = newScanAlerts[alertKey]!

        for (const alert of newAlerts) {
          const alertStr = `${alert.purl},${alert.manifests},${alert.type}`

          if (alert.error || alert.warn) {
            if (!consolidatedAlerts.has(alertStr)) {
              alerts.push(alert)
              consolidatedAlerts.add(alertStr)
            }
          }
        }
      } else {
        const newAlerts = newScanAlerts[alertKey]!
        const headAlerts = headScanAlerts[alertKey]!

        for (const alert of newAlerts) {
          const alertStr = `${alert.purl},${alert.manifests},${alert.type}`
          if (
            !headAlerts.includes(alert) &&
            !consolidatedAlerts.has(alertStr)
          ) {
            if (alert.error || alert.warn) {
              alerts.push(alert)
              consolidatedAlerts.add(alertStr)
            }
          }
        }
      }
    }

    return alerts
  }

  checkAlertCapabilities({
    capabilities,
    headPackage,
    packageId,
    pkg
  }: {
    pkg: Package
    capabilities: Record<string, string[]>
    packageId: string
    headPackage?: Package
  }): Record<string, string[]> {
    const alertTypes = {
      envVars: 'Environment',
      networkAccess: 'Network',
      filesystemAccess: 'File System',
      shellAccess: 'Shell'
    }

    for (const alert of pkg.alerts) {
      let newAlert = true
      if (headPackage !== undefined && headPackage.alerts.includes(alert)) {
        newAlert = false
      }
      if (alert.type in alertTypes && newAlert) {
        const value = alertTypes[alert.type as keyof typeof alertTypes]
        if (!(packageId in capabilities)) {
          capabilities[packageId] = [value]
        } else {
          if (!capabilities[packageId]!.includes(value)) {
            capabilities[packageId]!.push(value)
          }
        }
      }
    }

    return capabilities
  }

  compareCapabilities({
    headPackages,
    newPackages
  }: {
    newPackages: Record<string, Package>
    headPackages: Record<string, Package>
  }) {
    let capabilities: Record<string, string[]> = {}

    for (const packageId in newPackages) {
      const pkg = newPackages[packageId]!

      if (packageId in headPackages) {
        const headPackage = headPackages[packageId]!
        for (const alert of pkg.alerts) {
          if (!headPackage.alerts.includes(alert)) {
            capabilities = this.checkAlertCapabilities({
              pkg,
              capabilities,
              packageId,
              headPackage
            })
          }
        }
      } else {
        capabilities = this.checkAlertCapabilities({
          pkg,
          capabilities,
          packageId
        })
      }
    }

    return capabilities
  }

  addCapabilitiesToPurl(diff: Diff): Diff {
    const newPackages: Purl[] = []

    for (const purl of diff.newPackages) {
      if (purl.id in diff.newCapabilities) {
        const capabilities =
          diff.newCapabilities[purl.id as keyof typeof diff.newCapabilities]!
        if (capabilities.length > 0) {
          purl.capabilities = capabilities
          newPackages.push(purl)
        }
      } else {
        newPackages.push(purl)
      }
    }
    diff.newPackages = newPackages

    return diff
  }

  async compareSBOMs({
    headScan,
    newScan
  }: {
    newScan: Awaited<ReturnType<Core['getSbomData']>>
    headScan: Awaited<ReturnType<Core['getSbomData']>>
  }): Promise<Diff> {
    let diff = new Diff()
    const newPackages = this.createSbomDict(newScan)
    const headPackages = this.createSbomDict(headScan)

    let newScanAlerts: Record<string, Issue[]> = {}
    let headScanAlerts: Record<string, Issue[]> = {}
    const consolidated = new Set()

    for (const packageId in newPackages) {
      const { pkg, purl } = this.createPurl({
        packageId,
        packages: newPackages
      })
      const basePurl = `${purl.ecosystem}/${purl.name}@${purl.version}`

      if (
        !(packageId in headPackages) &&
        pkg.direct &&
        !consolidated.has(basePurl)
      ) {
        diff.newPackages.push(purl)
        consolidated.add(basePurl)
      }

      newScanAlerts = await this.createIssueAlerts({
        pkg,
        alerts: newScanAlerts,
        packages: newPackages
      })
    }

    for (const packageId in headPackages) {
      const { pkg, purl } = this.createPurl({
        packageId,
        packages: headPackages
      })

      if (!(packageId in newPackages) && pkg.direct) {
        diff.removedPackages.push(purl)
      }

      headScanAlerts = await this.createIssueAlerts({
        pkg,
        alerts: headScanAlerts,
        packages: headPackages
      })
    }

    diff.newAlerts = this.compareIssueAlerts({
      newScanAlerts,
      headScanAlerts,
      alerts: diff.newAlerts
    })
    diff.newCapabilities = this.compareCapabilities({
      newPackages,
      headPackages
    })
    diff = this.addCapabilitiesToPurl(diff)

    return diff
  }

  createPackageFromSbomArtifact(
    sbomArtifact: components['schemas']['SocketArtifact'][]
  ): Package[] {
    return sbomArtifact.map(
      sbomArtifact =>
        new Package({
          type: sbomArtifact.type,
          name: sbomArtifact.name,
          version: sbomArtifact.version,
          release: sbomArtifact.release,
          id: sbomArtifact.id,
          direct: sbomArtifact.direct,
          manifestFiles: sbomArtifact.manifestFiles,
          author: sbomArtifact.author,
          size: sbomArtifact.size,
          score: sbomArtifact.score,
          alerts: sbomArtifact.alerts,
          topLevelAncestors: sbomArtifact.topLevelAncestors,
          license: sbomArtifact.license
        })
    )
  }

  getLicenseDetails({ package: pkg }: { package: Package }): Package {
    const licenseText = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, 'license_texts.json'),
        'utf8'
      )
    ) as Record<string, string>
    const licenseStr = licenseText[pkg.license]
    if (licenseStr !== undefined) {
      pkg.license_text = licenseStr
    }
    return pkg
  }

  createSbomDict(
    sbomArtifacts: Awaited<ReturnType<typeof this.getSbomData>>
  ): Record<string, Package> {
    const packages: Record<string, Package> = {}
    const topLevelCount: Record<string, number> = {}

    for (const sbomArtifact of sbomArtifacts) {
      let pkg = new Package({
        type: sbomArtifact.type,
        name: sbomArtifact.name,
        version: sbomArtifact.version,
        release: sbomArtifact.release,
        id: sbomArtifact.id,
        direct: sbomArtifact.direct,
        manifestFiles: sbomArtifact.manifestFiles,
        author: sbomArtifact.author,
        size: sbomArtifact.size,
        score: sbomArtifact.score,
        alerts: sbomArtifact.alerts,
        topLevelAncestors: sbomArtifact.topLevelAncestors,
        license: sbomArtifact.license
      })

      if (pkg.id in packages) {
        console.log('Duplicate package?')
      } else {
        pkg = this.getLicenseDetails({ package: pkg })
        packages[pkg.id] = pkg

        for (const topId in sbomArtifact.topLevelAncestors ?? []) {
          if (!(topId in topLevelCount)) {
            topLevelCount[topId] = 1
          } else {
            topLevelCount[topId] += 1
          }
        }
      }
    }

    if (Object.keys(topLevelCount).length > 0) {
      for (const packageId in topLevelCount) {
        const pkg = packages[packageId]
        if (pkg) {
          pkg.transitives = topLevelCount[packageId] ?? 0
        }
      }
    }

    return packages
  }

  async createNewDiff({
    params = {}
  }: {
    params?: Omit<
      operations['CreateOrgFullScan']['parameters']['query'],
      'repo'
    >
  }): Promise<Diff> {
    let headFullScanId: string = ''
    let headFullScan: Awaited<ReturnType<typeof this.getSbomData>> = []

    try {
      const orgRepoResponse = await this.socket.getOrgRepo(
        this.owner,
        this.repo
      )
      if (orgRepoResponse.success) {
        headFullScanId = orgRepoResponse.data.head_full_scan_id ?? ''
        if (headFullScanId !== '') {
          headFullScan = await this.getSbomData({ fullScanId: headFullScanId })
        }
      }
    } catch (error) {
      console.error(error)
    }

    const newFullScan = await this.createFullScan({ params })
    newFullScan.packages = this.createSbomDict(newFullScan.sbom_artifacts)

    const diffReport = await this.compareSBOMs({
      newScan: newFullScan.sbom_artifacts,
      headScan: headFullScan
    })
    diffReport.packages = newFullScan.packages

    const baseSocket = 'https://socket.dev/dashboard/org'
    diffReport.id = newFullScan.id
    diffReport.reportUrl = `${baseSocket}/${this.owner}/sbom/${diffReport.id}`
    if (headFullScanId !== '') {
      diffReport.diffUrl = `${baseSocket}/${this.owner}/diff/${diffReport.id}/${headFullScanId}`
    } else {
      diffReport.diffUrl = diffReport.reportUrl
    }

    return diffReport
  }
}
