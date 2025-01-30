// https://github.com/SocketDev/socket-python-cli/blob/6d4fc56faee68d3a4764f1f80f84710635bdaf05/socketsecurity/core/classes.py
import { components } from '@socketsecurity/sdk/types/api'

type IntroducedBy = [string, string][]

export class Alert {
  key = ''
  type = ''
  severity = ''
  category = ''
  props = {}

  constructor(arg: Partial<Alert> = {}) {
    this.key = arg.key ?? this.key
    this.type = arg.type ?? this.type
    this.severity = arg.severity ?? this.severity
    this.category = arg.category ?? this.category
    this.props = arg.props ?? this.props
  }
}

export class Comment {
  id = 0
  body = ''
  body_list: string[] = []

  constructor(arg: Comment) {
    this.id = arg.id ?? this.id
    this.body = arg.body ?? this.body
    this.body_list = arg.body_list ?? this.body_list
  }
}

export class Diff {
  newPackages: Purl[] = []
  newCapabilities: Record<string, any> = {}
  removedPackages: Purl[] = []
  newAlerts: Issue[] = []
  id = ''
  sbom = ''
  packages: Record<string, Package> = {}
  reportUrl = ''
  diffUrl = ''
}

export class FullScan {
  id = ''
  created_at = ''
  updated_at = ''
  organizationId = ''
  repositoryId = ''
  branch = ''
  commit_message = ''
  commit_hash = ''
  pull_request = 0
  sbom_artifacts: components['schemas']['SocketArtifact'][] = []
  packages = {}

  constructor(obj: Partial<FullScan> = {}) {
    this.id = obj.id ?? this.id
    this.created_at = obj.created_at ?? this.created_at
    this.updated_at = obj.updated_at ?? this.updated_at
    this.organizationId = obj.organizationId ?? this.organizationId
    this.repositoryId = obj.repositoryId ?? this.repositoryId
    this.branch = obj.branch ?? this.branch
    this.commit_message = obj.commit_message ?? this.commit_message
    this.commit_hash = obj.commit_hash ?? this.commit_hash
    this.pull_request = obj.pull_request ?? this.pull_request
    this.sbom_artifacts = obj.sbom_artifacts ?? this.sbom_artifacts
    this.packages = obj.packages ?? this.packages
  }
}

export class Issue {
  pkg_type = ''
  pkg_name = ''
  pkg_version = ''
  category = ''
  type = ''
  severity = ''
  pkg_id = ''
  props = {}
  key = ''
  error = false
  warn = false
  ignore = false
  monitor = false
  description = ''
  title = ''
  emoji = ''
  next_step_title = ''
  suggestion = ''
  introduced_by: IntroducedBy = []
  manifests = ''
  url = ''
  purl = ''

  constructor(arg: {
    pkg_type: string | undefined
    pkg_name: string | undefined
    pkg_version: string | undefined
    type: string | undefined
    severity: string | undefined
    pkg_id: string | undefined
    props: Record<string, any> | undefined
    key: string | undefined
    error: boolean | undefined
    warn: boolean | undefined
    ignore: boolean | undefined
    monitor: boolean | undefined
    description: string | undefined
    title: string | undefined
    next_step_title: string | undefined
    suggestion: string | undefined
    introduced_by: IntroducedBy | undefined
    url: string | undefined
    purl: string | undefined
  }) {
    this.pkg_type = arg.pkg_type ?? this.pkg_type
    this.pkg_name = arg.pkg_name ?? this.pkg_name
    this.pkg_version = arg.pkg_version ?? this.pkg_version
    this.type = arg.type ?? this.type
    this.severity = arg.severity ?? this.severity
    this.pkg_id = arg.pkg_id ?? this.pkg_id
    this.props = arg.props ?? this.props
    this.key = arg.key ?? this.key
    this.error = arg.error ?? this.error
    this.warn = arg.warn ?? this.warn
    this.ignore = arg.ignore ?? this.ignore
    this.monitor = arg.monitor ?? this.monitor
    this.description = arg.description ?? this.description
    this.title = arg.title ?? this.title
    this.next_step_title = arg.next_step_title ?? this.next_step_title
    this.suggestion = arg.suggestion ?? this.suggestion

    if (arg.introduced_by) {
      const arr = []
      for (const item of arg.introduced_by) {
        const [, manifest] = item
        arr.push(manifest)
      }
      this.manifests = arr.join(';')
    }
  }
}

export class Package {
  type = ''
  name = ''
  version = ''
  release = ''
  id = ''
  direct = false
  manifestFiles: { file: string }[] = []
  author: string[] = []
  size = 0
  score: Score
  scores = {}
  alerts: NonNullable<components['schemas']['SocketArtifact']['alerts']> = []
  alert_counts = {}
  topLevelAncestors: string[] = []
  url = ''
  transitives = 0
  license = 'NoLicenseFound'
  license_text = ''
  purl = ''

  constructor(arg: {
    type: string | undefined
    name: string | undefined
    version: string | undefined
    release: string | undefined
    id: string | undefined
    direct: boolean | undefined
    manifestFiles: { file: string }[] | undefined
    author: string[] | undefined
    size: number | undefined
    score: Score | undefined
    alerts: components['schemas']['SocketArtifact']['alerts'] | undefined
    topLevelAncestors: string[] | undefined
    license: string | undefined
  }) {
    this.type = arg.type ?? this.type
    this.name = arg.name ?? this.name
    this.version = arg.version ?? this.version
    this.release = arg.release ?? this.release
    this.id = arg.id ?? this.id
    this.manifestFiles = arg.manifestFiles ?? this.manifestFiles
    this.author = arg.author ?? this.author
    this.size = arg.size ?? this.size
    this.alerts = arg.alerts ?? this.alerts
    this.topLevelAncestors = arg.topLevelAncestors ?? this.topLevelAncestors
    this.license = arg.license ?? this.license

    this.url = `https://socket.dev/${this.type}/package/${this.name}/overview/${this.version}`
    this.score = new Score(
      arg.score ?? {
        supplyChain: 0,
        quality: 0,
        license: 0,
        overall: 0,
        vulnerability: 0
      }
    )
    this.alert_counts = {
      critical: 0,
      high: 0,
      middle: 0,
      low: 0
    }
    this.purl = `${this.type}/${this.name}@${this.version}`
  }
}

export class Purl {
  id = ''
  name = ''
  version = ''
  ecosystem = ''
  direct = false
  author: string[] = []
  size = 0
  transitives = 0
  introduced_by: IntroducedBy = []
  capabilities: string[] = []
  // is_new = false
  author_url = ''
  url = ''
  purl = ''

  constructor(arg: {
    id: string | undefined
    name: string | undefined
    version: string | undefined
    ecosystem: string | undefined
    direct: boolean | undefined
    introduced_by: IntroducedBy | undefined
    author: string[] | undefined
    size: number | undefined
    transitives: number | undefined
    url: string | undefined
    purl: string | undefined
  }) {
    this.id = arg.id ?? this.id
    this.name = arg.name ?? this.name
    this.version = arg.version ?? this.version
    this.ecosystem = arg.ecosystem ?? this.ecosystem
    this.direct = arg.direct ?? this.direct
    this.author = arg.author ?? this.author
    this.size = arg.size ?? this.size
    this.transitives = arg.transitives ?? this.transitives
    this.introduced_by = arg.introduced_by ?? this.introduced_by
    this.url = arg.url ?? this.url
    this.purl = arg.purl ?? this.purl

    this.author_url = this.generateAuthorData(this.author, this.ecosystem)
  }

  private generateAuthorData(authors: string[], ecosystem: string): string {
    const arr = []
    for (const author of authors) {
      const url = `https://socket.dev/${ecosystem}/user/${author}`
      arr.push(`[${author}](${url})`)
    }
    return arr.join(',')
  }
}

export class Score {
  supplyChain = 0
  quality = 0
  license = 0
  overall = 0
  vulnerability = 0

  constructor(arg: Score) {
    this.supplyChain = (arg.supplyChain ?? 0) * 100
    this.quality = (arg.quality ?? 0) * 100
    this.license = (arg.license ?? 0) * 100
    this.overall = (arg.overall ?? 0) * 100
    this.vulnerability = (arg.vulnerability ?? 0) * 100
  }
}
