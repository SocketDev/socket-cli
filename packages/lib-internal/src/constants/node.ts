/**
 * Node.js runtime: versions, features, flags, and capabilities.
 */

const NODE_VERSION = process.version

// Version detection.
export function getNodeVersion(): string {
  return NODE_VERSION
}

export function getNodeMajorVersion(): number {
  return Number.parseInt(NODE_VERSION.slice(1).split('.')[0] || '0', 10)
}

// Maintained Node.js versions.
let _maintainedNodeVersions:
  | (readonly string[] & {
      current: string
      last: string
      next: string
      previous: string
    })
  | undefined
export function getMaintainedNodeVersions() {
  if (_maintainedNodeVersions === undefined) {
    _maintainedNodeVersions = require('#lib/maintained-node-versions').default
  }
  return _maintainedNodeVersions
}

// Feature detection.
export function supportsNodeCompileCacheApi(): boolean {
  const major = getNodeMajorVersion()
  return major >= 24
}

export function supportsNodeCompileCacheEnvVar(): boolean {
  const major = getNodeMajorVersion()
  return major >= 22
}

export function supportsNodeDisableWarningFlag(): boolean {
  const major = getNodeMajorVersion()
  return major >= 21
}

export function supportsNodePermissionFlag(): boolean {
  const major = getNodeMajorVersion()
  return major >= 20
}

export function supportsNodeRequireModule(): boolean {
  const major = getNodeMajorVersion()
  return (
    major >= 23 ||
    (major === 22 &&
      Number.parseInt(NODE_VERSION.split('.')[1] || '0', 10) >= 12)
  )
}

export function supportsNodeRun(): boolean {
  const major = getNodeMajorVersion()
  return (
    major >= 23 ||
    (major === 22 &&
      Number.parseInt(NODE_VERSION.split('.')[1] || '0', 10) >= 11)
  )
}

export function supportsNodeDisableSigusr1Flag(): boolean {
  const major = getNodeMajorVersion()
  // --disable-sigusr1 added in v22.14.0, v23.7.0.
  // Stabilized in v22.20.0, v24.8.0.
  if (major >= 24) {
    const minor = Number.parseInt(NODE_VERSION.split('.')[1] || '0', 10)
    return minor >= 8
  }
  if (major === 23) {
    const minor = Number.parseInt(NODE_VERSION.split('.')[1] || '0', 10)
    return minor >= 7
  }
  if (major === 22) {
    const minor = Number.parseInt(NODE_VERSION.split('.')[1] || '0', 10)
    return minor >= 14
  }
  return false
}

let _nodeDisableSigusr1Flags: string[]
export function getNodeDisableSigusr1Flags(): string[] {
  if (_nodeDisableSigusr1Flags === undefined) {
    // SIGUSR1 is reserved by Node.js for starting the debugger/inspector.
    // In production CLI environments, we want to prevent debugger attachment.
    //
    // --disable-sigusr1: Prevents Signal I/O Thread from listening to SIGUSR1 (v22.14.0+).
    // --no-inspect: Disables inspector on older Node versions that don't support --disable-sigusr1.
    //
    // Note: --disable-sigusr1 is the correct solution (prevents thread creation entirely).
    // --no-inspect is a fallback that still creates the signal handler thread but blocks later.
    _nodeDisableSigusr1Flags = supportsNodeDisableSigusr1Flag()
      ? ['--disable-sigusr1']
      : ['--no-inspect']
  }
  return _nodeDisableSigusr1Flags
}

export function supportsProcessSend(): boolean {
  return typeof process.send === 'function'
}

// Node.js flags.
let _nodeHardenFlags: string[]
export function getNodeHardenFlags(): string[] {
  if (_nodeHardenFlags === undefined) {
    const major = getNodeMajorVersion()
    const flags = [
      '--disable-proto=delete',
      // Node.js 24+ uses --permission instead of --experimental-permission.
      // The permission model graduated from experimental to production-ready.
      major >= 24 ? '--permission' : '--experimental-permission',
      // Force uncaught exceptions policy for N-API addons (Node.js 22+).
      '--force-node-api-uncaught-exceptions-policy',
    ]
    // Only add policy flag if we're using experimental permission (Node < 24).
    // Node 24+ --policy requires a policy file which we don't have.
    if (major < 24) {
      flags.push('--experimental-policy')
    }
    _nodeHardenFlags = flags
  }
  return _nodeHardenFlags
}

let _nodePermissionFlags: string[]
export function getNodePermissionFlags(): string[] {
  if (_nodePermissionFlags === undefined) {
    const major = getNodeMajorVersion()
    // Node.js 24+ requires explicit permission grants when using --permission flag.
    // npm needs filesystem access to read package.json files and node_modules.
    if (major >= 24) {
      _nodePermissionFlags = [
        // Allow reading from the entire filesystem (npm needs to read package.json, node_modules, etc.).
        '--allow-fs-read=*',
        // Allow writing to the entire filesystem (npm needs to write to node_modules, cache, etc.).
        '--allow-fs-write=*',
        // Allow spawning child processes (npm needs to run lifecycle scripts, git, etc.).
        '--allow-child-process',
      ]
    } else {
      // Node.js 20-23 with --experimental-permission doesn't require explicit grants
      // or uses different permission API.
      _nodePermissionFlags = []
    }
  }
  return _nodePermissionFlags
}

let _nodeNoWarningsFlags: string[]
export function getNodeNoWarningsFlags(): string[] {
  if (_nodeNoWarningsFlags === undefined) {
    _nodeNoWarningsFlags = ['--no-warnings', '--no-deprecation']
  }
  return _nodeNoWarningsFlags
}

// Execution path.
export function getExecPath(): string {
  return process.execPath
}

// Node.js constants.
export const NODE_SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const ESNEXT = 'esnext'
