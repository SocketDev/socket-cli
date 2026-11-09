import childProcess from 'node:child_process'
import dgram from 'node:dgram'
import { readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import util from 'node:util'
import { workerData } from 'node:worker_threads'

// eslint-disable-next-line import-x/no-unresolved, n/no-missing-import -- The worker path resolves in its staged SEA VFS payload.
import { isObjectObject } from './utils/is-object-object.mjs'

const ipc = workerData?.socketIpc
if (
  !ipc ||
  typeof ipc.projectPath !== 'string' ||
  typeof ipc.sourceRoot !== 'string' ||
  typeof ipc.outputPath !== 'string'
) {
  throw new Error('Invalid Socket cdxgen Worker request')
}

// cdxgen probes host tools while importing its API. A nonempty allowlist
// prevents those probes from spawning commands; the restricted npm API path
// does not need any subprocesses.
process.env.CDXGEN_PLUGINS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'plugins-empty',
)
process.env.CDXGEN_ALLOWED_COMMANDS = 'socket-sea-no-commands-allowed'

const denied = () => {
  throw new Error(
    'Standalone cdxgen cannot start subprocesses or access the network',
  )
}
for (const name of [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]) {
  childProcess[name] = denied
}
for (const module of [http, https]) {
  module.request = denied
  module.get = denied
}
net.connect = denied
net.createConnection = denied
net.Socket.prototype.connect = denied
http2.connect = denied
dgram.createSocket = denied
tls.connect = denied
tls.TLSSocket.prototype.connect = denied
globalThis.fetch = denied
syncBuiltinESMExports()

const isolatedRoot = path.resolve(ipc.projectPath)
const originalRoot = path.resolve(ipc.sourceRoot)
const packageJson = JSON.parse(
  await readFile(path.join(isolatedRoot, 'package.json'), 'utf8'),
)
const packageLock = JSON.parse(
  await readFile(path.join(isolatedRoot, 'package-lock.json'), 'utf8'),
)
if (!isObjectObject(packageJson)) {
  throw new Error('Invalid package.json in cdxgen project')
}
if (!isObjectObject(packageLock)) {
  throw new Error('Malformed npm package-lock.json')
}
if (![1, 3].includes(packageLock.lockfileVersion)) {
  throw new Error(
    'The standalone cdxgen API supports package-lock versions 1 and 3 only',
  )
}
if (packageJson.workspaces || packageJson.workspace) {
  throw new Error('The standalone cdxgen API does not support workspaces')
}
const hasLocalDependency = value =>
  typeof value === 'string' && /^(?:file:|link:|workspace:)/i.test(value)
const validPackageName = name => {
  if (typeof name !== 'string' || !name || name.includes('\\')) {
    return false
  }
  const parts = name.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    return false
  }
  return name.startsWith('@')
    ? parts.length === 2 && parts[0].length > 1
    : parts.length === 1
}
for (const group of [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]) {
  if (packageJson[group] !== undefined && !isObjectObject(packageJson[group])) {
    throw new Error(`Invalid ${group} in package.json`)
  }
  if (
    Object.keys(packageJson[group] || {}).some(name => !validPackageName(name))
  ) {
    throw new Error(`Invalid package name in package.json ${group}`)
  }
  if (Object.values(packageJson[group] || {}).some(hasLocalDependency)) {
    throw new Error(
      'The standalone cdxgen API does not support local or workspace dependencies',
    )
  }
}
const inspectV1Dependencies = (
  dependencies,
  dependencyPath = 'dependencies',
) => {
  if (dependencies === undefined) {
    return
  }
  if (!isObjectObject(dependencies)) {
    throw new Error(`Malformed package-lock v1 ${dependencyPath}`)
  }
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (!validPackageName(name)) {
      throw new Error(`Invalid package-lock v1 dependency name '${name}'`)
    }
    if (!isObjectObject(dependency)) {
      throw new Error(`Malformed package-lock v1 dependency '${name}'`)
    }
    if (typeof dependency.version !== 'string' || !dependency.version) {
      throw new Error(`Malformed package-lock v1 version for '${name}'`)
    }
    for (const metadataKey of [
      '_socketOptionalDependencies',
      '_socketPeerDependencies',
    ]) {
      if (
        dependency[metadataKey] !== undefined &&
        (!Array.isArray(dependency[metadataKey]) ||
          dependency[metadataKey].some(item => typeof item !== 'string'))
      ) {
        throw new Error(`Malformed Synp dependency metadata for '${name}'`)
      }
    }
    if (
      hasLocalDependency(dependency.version) ||
      hasLocalDependency(dependency.resolved) ||
      dependency.link
    ) {
      throw new Error(
        'The standalone cdxgen API does not support local or linked lockfile entries',
      )
    }
    inspectV1Dependencies(
      dependency.dependencies,
      `${dependencyPath}.${name}.dependencies`,
    )
  }
}
const checkRootDependencyGroup = (
  group,
  lockDependencies,
  groupName,
  optional,
  optionalNames = new Set(),
) => {
  if (group === undefined) {
    return
  }
  if (!isObjectObject(group)) {
    throw new Error(`Malformed package.json ${groupName}`)
  }
  for (const name of Object.keys(group)) {
    if (
      !(
        isObjectObject(lockDependencies) &&
        Object.hasOwn(lockDependencies, name)
      ) &&
      !optional &&
      !optionalNames.has(name)
    ) {
      throw new Error(
        `package-lock is missing required root ${groupName} '${name}'`,
      )
    }
  }
}

if (packageLock.lockfileVersion === 1) {
  const rootDependencies = packageLock.dependencies ?? {}
  if (!isObjectObject(rootDependencies)) {
    throw new Error('Malformed package-lock v1 dependencies map')
  }
  inspectV1Dependencies(rootDependencies)
  checkRootDependencyGroup(
    packageJson.dependencies,
    rootDependencies,
    'dependencies',
    false,
    new Set(Object.keys(packageJson.optionalDependencies || {})),
  )
  checkRootDependencyGroup(
    packageJson.devDependencies,
    rootDependencies,
    'devDependencies',
    false,
  )
  checkRootDependencyGroup(
    packageJson.optionalDependencies,
    rootDependencies,
    'optionalDependencies',
    true,
  )
  checkRootDependencyGroup(
    packageJson.peerDependencies,
    rootDependencies,
    'peerDependencies',
    true,
  )

  const resolveV1Dependency = (name, ownDependencies, ancestorMaps) =>
    Boolean(
      (isObjectObject(ownDependencies) &&
        Object.hasOwn(ownDependencies, name)) ||
        ancestorMaps.some(
          map => isObjectObject(map) && Object.hasOwn(map, name),
        ),
    )
  const validateV1Graph = (dependencies, ancestorMaps = []) => {
    for (const [packageName, dependency] of Object.entries(
      dependencies || {},
    )) {
      const requires = dependency.requires
      if (requires !== undefined && !isObjectObject(requires)) {
        throw new Error(
          `Malformed package-lock v1 requires map for '${packageName}'`,
        )
      }
      if (
        Object.values(requires || {}).some(value => typeof value !== 'string')
      ) {
        throw new Error(
          `Malformed package-lock v1 requirement spec for '${packageName}'`,
        )
      }
      const optional = new Set(dependency._socketOptionalDependencies || [])
      const peers = new Set(dependency._socketPeerDependencies || [])
      const visibleMaps = [dependencies, ...ancestorMaps]
      for (const requiredName of Object.keys(requires || {})) {
        if (!validPackageName(requiredName)) {
          throw new Error(
            `Invalid package-lock v1 requirement name '${requiredName}'`,
          )
        }
        if (
          !resolveV1Dependency(
            requiredName,
            dependency.dependencies,
            visibleMaps,
          ) &&
          !optional.has(requiredName) &&
          !Object.hasOwn(dependency.optionalDependencies || {}, requiredName) &&
          !peers.has(requiredName)
        ) {
          throw new Error(
            `package-lock v1 is missing required '${requiredName}' for '${packageName}'`,
          )
        }
      }
      validateV1Graph(dependency.dependencies, visibleMaps)
    }
  }
  validateV1Graph(rootDependencies)
} else {
  const packages = packageLock.packages
  if (
    !isObjectObject(packages) ||
    !Object.hasOwn(packages, '') ||
    !isObjectObject(packages[''])
  ) {
    throw new Error(
      'Malformed package-lock v3 packages map or root package record',
    )
  }
  for (const [packagePath, dependency] of Object.entries(packages)) {
    if (!isObjectObject(dependency)) {
      throw new Error(`Malformed package-lock v3 record '${packagePath}'`)
    }
    if (packagePath) {
      const parts = packagePath.split('/')
      if (
        !packagePath.startsWith('node_modules/') ||
        packagePath.startsWith('/') ||
        packagePath.includes('\\') ||
        parts.some(part => !part || part === '.' || part === '..')
      ) {
        throw new Error(`Invalid package-lock v3 package path '${packagePath}'`)
      }
      if (typeof dependency.version !== 'string' || !dependency.version) {
        throw new Error(`Missing package-lock v3 version for '${packagePath}'`)
      }
      if (
        hasLocalDependency(dependency.version) ||
        hasLocalDependency(dependency.resolved) ||
        dependency.link
      ) {
        throw new Error(
          'The standalone cdxgen API does not support local or linked lockfile entries',
        )
      }
    }
  }

  const resolveV3Dependency = (name, packagePath) => {
    let current = packagePath
    while (current) {
      const candidate = `${current}/node_modules/${name}`
      if (Object.hasOwn(packages, candidate)) {
        return true
      }
      const parentMarker = current.lastIndexOf('/node_modules/')
      current = parentMarker < 0 ? '' : current.slice(0, parentMarker)
    }
    return Object.hasOwn(packages, `node_modules/${name}`)
  }
  const validateV3DependencyGroup = (
    group,
    packagePath,
    groupName,
    optional,
    optionalNames = new Set(),
  ) => {
    if (group === undefined) {
      return
    }
    if (!isObjectObject(group)) {
      throw new Error(
        `Malformed package-lock v3 ${groupName} map at '${packagePath || '<root>'}'`,
      )
    }
    for (const name of Object.keys(group)) {
      if (
        !resolveV3Dependency(name, packagePath) &&
        !optional &&
        !optionalNames.has(name)
      ) {
        throw new Error(
          `package-lock v3 is missing required '${name}' at '${packagePath || '<root>'}'`,
        )
      }
    }
  }
  const rootOptionalNames = new Set(
    Object.keys(packageJson.optionalDependencies || {}),
  )
  const validateV3RootGroup = (group, groupName, optional) => {
    if (group === undefined) {
      return
    }
    if (!isObjectObject(group)) {
      throw new Error(`Malformed package.json ${groupName}`)
    }
    for (const name of Object.keys(group)) {
      if (
        !resolveV3Dependency(name, '') &&
        !optional &&
        !(groupName === 'dependencies' && rootOptionalNames.has(name))
      ) {
        throw new Error(
          `package-lock v3 is missing required root ${groupName} '${name}'`,
        )
      }
    }
  }
  validateV3RootGroup(packageJson.dependencies, 'dependencies', false)
  validateV3RootGroup(packageJson.devDependencies, 'devDependencies', false)
  validateV3RootGroup(
    packageJson.optionalDependencies,
    'optionalDependencies',
    true,
  )
  validateV3RootGroup(packageJson.peerDependencies, 'peerDependencies', true)
  for (const [packagePath, dependency] of Object.entries(packages)) {
    validateV3DependencyGroup(
      dependency.dependencies,
      packagePath,
      'dependencies',
      false,
      new Set(Object.keys(dependency.optionalDependencies || {})),
    )
    validateV3DependencyGroup(
      dependency.devDependencies,
      packagePath,
      'devDependencies',
      packagePath !== '',
    )
    validateV3DependencyGroup(
      dependency.optionalDependencies,
      packagePath,
      'optionalDependencies',
      true,
    )
    validateV3DependencyGroup(
      dependency.peerDependencies,
      packagePath,
      'peerDependencies',
      true,
    )
  }
}
// eslint-disable-next-line import-x/no-unresolved, n/no-missing-import -- The package is staged beside this worker in the SEA VFS.
const { createNodejsBom } = await import('./lib/cli/index.js')

let incompleteNotice = ''
const originalConsole = new Map()
for (const method of ['log', 'warn', 'error']) {
  const original = console[method]
  originalConsole.set(method, original)
  console[method] = (...args) => {
    const message = util.format(...args)
    if (
      message.includes('Unable to parse') &&
      message.includes('The resulting SBOM would be incomplete.')
    ) {
      incompleteNotice += message
    }
    original.apply(console, args)
  }
}
let bom
try {
  bom = await createNodejsBom(isolatedRoot, {
    projectType: ['npm'],
    installDeps: false,
    noBabel: true,
    recurse: false,
    deep: false,
    evidence: false,
    includeCrypto: false,
    includeFormulation: false,
    lifecycle: 'pre-build',
    specVersion: 1.6,
    output: undefined,
  })
} finally {
  for (const [method, original] of originalConsole) {
    console[method] = original
  }
}
if (incompleteNotice) {
  throw new Error(
    'cdxgen could not parse the package-lock; refusing an incomplete SBOM',
  )
}
if (!bom?.bomJson) {
  throw new Error('cdxgen did not produce an npm BOM')
}
const rewriteTemporaryPath = sourceValue => {
  const sourcePath = path.resolve(
    path.isAbsolute(sourceValue)
      ? sourceValue
      : path.join(isolatedRoot, sourceValue),
  )
  if (
    sourcePath === isolatedRoot ||
    sourcePath.startsWith(`${isolatedRoot}${path.sep}`)
  ) {
    return path.join(originalRoot, path.relative(isolatedRoot, sourcePath))
  }
  return sourceValue
}
const rewriteSourcePaths = (value, inEvidence = false) => {
  if (!value || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      rewriteSourcePaths(child, inEvidence)
    }
    return
  }
  if (value.name === 'SrcFile' && typeof value.value === 'string') {
    value.value = rewriteTemporaryPath(value.value)
  } else if (
    value.name === 'cdx:npm:binPaths' &&
    typeof value.value === 'string'
  ) {
    value.value = value.value.split(', ').map(rewriteTemporaryPath).join(', ')
  }
  const evidence = inEvidence || Object.hasOwn(value, 'identity')
  for (const [key, child] of Object.entries(value)) {
    if (
      evidence &&
      ['value', 'concludedValue', 'location'].includes(key) &&
      typeof child === 'string'
    ) {
      value[key] = rewriteTemporaryPath(child)
    } else {
      rewriteSourcePaths(child, evidence || key === 'evidence')
    }
  }
}
rewriteSourcePaths(bom.bomJson)
const serialized = `${JSON.stringify(bom.bomJson, null, 2)}\n`
if (ipc.outputPath === '-') {
  process.stdout.write(serialized)
} else {
  await writeFile(ipc.outputPath, serialized, { encoding: 'utf8' })
}
