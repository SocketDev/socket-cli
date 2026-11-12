import { createHash } from 'node:crypto'
/* eslint-disable no-await-in-loop -- Inventory traversal and hashing must remain deterministic. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { parse as parseYaml } from 'yaml'

const legalFilenamePattern =
  /^(?:license|licence|copying|copyright|notice|patents?)(?:[._ -].*)?$/i

const curatedLegalDocuments = {
  '@npmcli/agent@3.0.0': [
    {
      filename: 'npmcli-agent-3.0.0-ISC.txt',
      kind: 'license',
      sourcePath:
        'ISC terms (npm package metadata declares ISC; npm tarball and pinned upstream commit omit LICENSE)',
      source: 'https://opensource.org/license/isc-license-txt/',
      attributionSource: 'https://registry.npmjs.org/@npmcli/agent/3.0.0',
      attributionInferredFrom:
        'Copyright holder is inferred from the npm author field (GitHub Inc.); no published copyright notice or year was found.',
    },
  ],
  '@npmcli/agent@4.0.0': [
    {
      filename: 'npmcli-agent-4.0.0-ISC.txt',
      kind: 'license',
      sourcePath:
        'ISC terms (npm package metadata declares ISC; npm tarball and pinned upstream commit omit LICENSE)',
      source: 'https://opensource.org/license/isc-license-txt/',
      attributionSource: 'https://registry.npmjs.org/@npmcli/agent/4.0.0',
      attributionInferredFrom:
        'Copyright holder is inferred from the npm author field (GitHub Inc.); no published copyright notice or year was found.',
    },
  ],
  '@sigstore/verify@3.1.1': [
    {
      filename: 'sigstore-verify-3.1.1-Apache-2.0.txt',
      kind: 'license',
      sourcePath: 'LICENSE (upstream sigstore-js root file at package gitHead)',
      source:
        'https://github.com/sigstore/sigstore-js/blob/c1dc7d4778a450787fc72b083f2490ad02b714c6/LICENSE',
    },
  ],
  'x256@0.0.2': [
    {
      filename: 'x256-0.0.2-MIT.txt',
      kind: 'license',
      sourcePath:
        'MIT terms (npm README declares MIT; npm tarball and pinned upstream commit omit LICENSE)',
      source:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt',
      attributionSource: 'https://registry.npmjs.org/x256/0.0.2',
      attributionInferredFrom:
        'Copyright holder is inferred from the npm author field (James Halliday); no published copyright notice or year was found.',
    },
  ],
  'ansi-term@0.0.2': [
    {
      filename: 'ansi-term-0.0.2-ISC.txt',
      kind: 'license',
      sourcePath:
        'ISC terms (npm package metadata declares ISC; npm tarball and upstream repository omit LICENSE)',
      source: 'https://opensource.org/license/isc-license-txt/',
      attributionSource: 'https://registry.npmjs.org/ansi-term/0.0.2',
      attributionInferredFrom:
        'Copyright holder is inferred from the npm author field (Yaron Naveh); no published copyright notice or year was found.',
    },
  ],
  'drawille-canvas-blessed-contrib@0.1.3': [
    {
      filename: 'drawille-canvas-blessed-contrib-0.1.3-MIT.txt',
      kind: 'license',
      sourcePath:
        'MIT terms (npm README declares MIT; npm tarball and pinned upstream commit omit LICENSE)',
      source:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt',
      attributionSource:
        'https://registry.npmjs.org/drawille-canvas-blessed-contrib/0.1.3',
      attributionInferredFrom:
        'Copyright holder is inferred from the npm author field (Bence Dányi); no published copyright notice or year was found.',
    },
  ],
  'err-code@2.0.3': [
    {
      filename: 'err-code-2.0.3-MIT.txt',
      kind: 'license',
      sourcePath: 'MIT text (package README declares MIT)',
      source:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt',
      attributionSource: 'https://registry.npmjs.org/err-code/2.0.3',
      attributionInferredFrom:
        'npm author field (IndigoUnited); no package copyright line or LICENSE file is published.',
    },
  ],
  'imurmurhash@0.1.4': [
    {
      filename: 'imurmurhash-0.1.4-MIT.txt',
      kind: 'license',
      sourcePath: 'LICENSE (upstream file; omitted from npm tarball)',
      source: 'https://github.com/jensyt/imurmurhash-js/blob/0.1.4/LICENSE',
    },
  ],
  'spdx-exceptions@2.5.0': [
    {
      filename: 'spdx-exceptions-2.5.0-CC-BY-3.0.txt',
      kind: 'license',
      sourcePath: 'CC-BY-3.0 legal code',
      source:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/CC-BY-3.0.txt',
    },
  ],
  'spdx-license-ids@3.0.22': [
    {
      filename: 'spdx-license-ids-3.0.22-CC0-1.0.txt',
      kind: 'license',
      sourcePath: 'CC0-1.0 legal code',
      source:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/CC0-1.0.txt',
    },
  ],
}

const coreThirdPartyPackageIds = new Set([
  '@npmcli/agent@3.0.0',
  '@npmcli/agent@4.0.0',
  '@sigstore/verify@3.1.1',
  'x256@0.0.2',
  'ansi-term@0.0.2',
  'drawille-canvas-blessed-contrib@0.1.3',
])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map(key => [key, stableValue(value[key])]),
  )
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`
}

function sourcePathFromId(id) {
  const withoutQuery = id.split('?')[0]
  if (withoutQuery.startsWith('file:')) {
    return url.fileURLToPath(withoutQuery)
  }
  return withoutQuery
}

async function findPackageRoot(modulePath) {
  let current = path.dirname(modulePath)
  while (current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, 'package.json')
    try {
      const metadata = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
      if (
        typeof metadata.name === 'string' &&
        typeof metadata.version === 'string'
      ) {
        return { directory: current, metadata }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error
      }
    }
    if (path.basename(current) === 'node_modules') {
      break
    }
    current = path.dirname(current)
  }
}

async function findLegalFiles(packageRoot) {
  const files = []
  const skippedLinks = []
  const visit = async (directory, relativeDirectory = '') => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((left, right) => compareText(left.name, right.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue
      }
      const relativePath = path.posix.join(
        relativeDirectory.split(path.sep).join('/'),
        entry.name,
      )
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath, path.join(relativeDirectory, entry.name))
      } else if (entry.isSymbolicLink()) {
        if (legalFilenamePattern.test(entry.name)) {
          skippedLinks.push(relativePath)
        }
      } else if (entry.isFile() && legalFilenamePattern.test(entry.name)) {
        files.push({ fullPath, relativePath })
      }
    }
  }
  await visit(packageRoot)
  return { files, skippedLinks }
}

function normalizedInstalledInstance(packageRoot, root) {
  const parts = path.resolve(packageRoot).split(path.sep).filter(Boolean)
  const pnpmIndex = parts.lastIndexOf('.pnpm')
  if (pnpmIndex >= 0) {
    return `pnpm-virtual-store/${parts.slice(pnpmIndex + 1).join('/')}`
  }
  const storeIndex = parts.lastIndexOf('store')
  if (storeIndex >= 0 && parts[storeIndex + 1]?.startsWith('v')) {
    return `pnpm-content-store/${parts.slice(storeIndex + 2).join('/')}`
  }
  const relative = path.relative(root, packageRoot).split(path.sep).join('/')
  if (relative && !relative.startsWith('../')) {
    return `repository/${relative}`
  }
  return `external-store/${path.basename(packageRoot)}`
}

function lockContextFor(lock, packageName, version, root, packageRoot) {
  const packageKey = `${packageName}@${version}`
  const packageEntry = lock.packages?.[packageKey]
  const snapshotCandidates = Object.keys(lock.snapshots ?? {})
    .filter(key => key === packageKey || key.startsWith(`${packageKey}(`))
    .sort(compareText)
  const patch = lock.patchedDependencies?.[packageKey]
  const resolution = packageEntry?.resolution ?? null
  const { integrity: declaredIntegrity, ...otherResolutionFields } =
    resolution ?? {}
  const output = {
    packageResolutionLocator: packageEntry ? packageKey : null,
    snapshotLocators: snapshotCandidates,
    snapshotAttribution:
      snapshotCandidates.length > 1
        ? 'ambiguous-unverified'
        : snapshotCandidates.length === 1
          ? 'single-candidate-unverified-not-bound-to-installed-instance'
          : 'no-lock-snapshot-candidate',
    normalizedInstalledInstance: normalizedInstalledInstance(packageRoot, root),
    declaredLockIntegrity: declaredIntegrity ?? null,
    declaredResolutionContext: otherResolutionFields,
    patch: null,
  }
  if (patch) {
    const patchPath = path.join(root, patch.path)
    output.patch = {
      path: patch.path,
      declaredPatchHash: patch.hash ?? null,
      patchFileSha256: null,
      patchFileHashMatchesLock: false,
      appliedSourceVerification: 'unverified',
    }
    return fs.readFile(patchPath).then(
      bytes => {
        output.patch.patchFileSha256 = sha256(bytes)
        output.patch.patchFileHashMatchesLock =
          output.patch.patchFileSha256 === patch.hash
        return output
      },
      error => {
        if (error?.code === 'ENOENT') {
          return output
        }
        throw error
      },
    )
  }
  return Promise.resolve(output)
}

function packageSlug(packageName, version, lockContext) {
  const identity = `${packageName}@${version}\0${lockContext.normalizedInstalledInstance}\0${lockContext.snapshotLocators.join('|')}`
  return `${packageName.replace(/[^A-Za-z0-9._-]+/g, '_')}-${version}-${sha256(Buffer.from(identity)).slice(0, 12)}`
}

async function collectPackageRecords(ids, { lock, root }) {
  const packages = new Map()
  const unmappedModules = []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || id.startsWith('\0')) {
      continue
    }
    const rawPath = sourcePathFromId(id)
    if (
      !path.isAbsolute(rawPath) ||
      !rawPath.split(path.sep).includes('node_modules')
    ) {
      continue
    }
    let modulePath
    try {
      modulePath = await fs.realpath(rawPath)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }
      throw error
    }
    if (seen.has(modulePath)) {
      continue
    }
    seen.add(modulePath)
    const packageInfo = await findPackageRoot(modulePath)
    const moduleBytes = await fs.readFile(modulePath)
    if (!packageInfo) {
      unmappedModules.push({
        path: `unmapped/${path.basename(modulePath)}-${sha256(moduleBytes).slice(0, 12)}`,
        sha256: sha256(moduleBytes),
        verification: 'unverified',
        verificationReason:
          'No package metadata root was found for this included Rollup module.',
      })
      continue
    }
    const { directory, metadata } = packageInfo
    const lockContext = await lockContextFor(
      lock,
      metadata.name,
      metadata.version,
      root,
      directory,
    )
    const sourceFile = path
      .relative(directory, modulePath)
      .split(path.sep)
      .join('/')
    const instanceKey = `${metadata.name}@${metadata.version}\0${lockContext.normalizedInstalledInstance}\0${lockContext.snapshotLocators.join('|')}`
    let record = packages.get(instanceKey)
    if (!record) {
      record = {
        name: metadata.name,
        version: metadata.version,
        packageRoot: directory,
        instanceKey,
        license: metadata.license ?? metadata.licenses ?? null,
        lockContext,
        modules: [],
        legalDocuments: [],
        obligations: [],
      }
      packages.set(instanceKey, record)
    }
    record.modules.push({
      packageInstance: lockContext.normalizedInstalledInstance,
      path: `${lockContext.normalizedInstalledInstance}/${sourceFile}`,
      packagePath: sourceFile,
      sha256: sha256(moduleBytes),
      verification: 'unverified',
      verificationReason:
        'Hash identifies installed module bytes; declared lock SRI does not authenticate installed, patched, or Rollup-generated bytes.',
    })
  }
  for (const record of packages.values()) {
    record.modules.sort((left, right) => compareText(left.path, right.path))
    const { files, skippedLinks } = await findLegalFiles(record.packageRoot)
    const slug = packageSlug(record.name, record.version, record.lockContext)
    const stagedPaths = new Set()
    for (const file of files) {
      const bytes = await fs.readFile(file.fullPath)
      const digest = sha256(bytes)
      const relative = file.relativePath
        .split('/')
        .map(segment => segment.replace(/[^A-Za-z0-9._-]+/g, '_'))
        .join('/')
      const outputPath = `third-party-notices/${slug}/${relative}.${digest.slice(0, 12)}`
      if (stagedPaths.has(outputPath)) {
        continue
      }
      stagedPaths.add(outputPath)
      record.legalDocuments.push({
        packagePath: file.relativePath,
        outputPath,
        sha256: digest,
        type: /^(?:notice|copyright|patents?)/i.test(
          path.posix.basename(file.relativePath),
        )
          ? 'notice'
          : 'license',
        contents: bytes,
      })
    }
    if (!record.legalDocuments.some(document => document.type === 'license')) {
      for (const document of curatedLegalDocuments[
        `${record.name}@${record.version}`
      ] ?? []) {
        const packageId = `${record.name}@${record.version}`
        const legalDirectory = coreThirdPartyPackageIds.has(packageId)
          ? 'core-third-party'
          : 'cdxgen-third-party'
        const curatedPath = path.join(
          root,
          'src/sea/licenses',
          legalDirectory,
          document.filename,
        )
        const contents = await fs.readFile(curatedPath)
        const digest = sha256(contents)
        const outputPath = `third-party-notices/${slug}/${document.filename}.${digest.slice(0, 12)}`
        record.legalDocuments.push({
          packagePath: document.sourcePath,
          outputPath,
          sha256: digest,
          type: document.kind,
          contents,
          source: document.source,
          ...(document.attributionSource
            ? { attributionSource: document.attributionSource }
            : {}),
          ...(document.attributionInferredFrom
            ? { attributionInferredFrom: document.attributionInferredFrom }
            : {}),
        })
        if (document.attributionInferredFrom) {
          record.obligations.push({
            code: 'inferred-copyright-attribution',
            message: document.attributionInferredFrom,
          })
        }
      }
    }
    record.legalDocuments.sort((left, right) =>
      compareText(left.outputPath, right.outputPath),
    )
    if (!record.legalDocuments.some(document => document.type === 'license')) {
      record.obligations.push({
        code: 'missing-license-text',
        message: 'No license text file was found in the included package tree.',
      })
    }
    if (skippedLinks.length) {
      record.obligations.push({
        code: 'unresolved-license-symlink',
        paths: [...new Set(skippedLinks)].sort(compareText),
        message:
          'A license or notice symlink was not followed when collecting package texts.',
      })
    }
  }
  return {
    packages: [...packages.values()].sort((left, right) =>
      compareText(
        `${left.name}@${left.version}\0${left.instanceKey}`,
        `${right.name}@${right.version}\0${right.instanceKey}`,
      ),
    ),
    unmappedModules: unmappedModules.sort((left, right) =>
      compareText(left.path, right.path),
    ),
  }
}

function serializeInventory(records, { bundleId, lockfilePath }) {
  return {
    schemaVersion: 1,
    generator: 'rollup-included-module-source-hashes',
    bundle: bundleId,
    lockfile: { path: lockfilePath, lockfileVersion: records.lockfileVersion },
    sourceAuthentication: 'unverified',
    sourceAuthenticationReason:
      'Per-file hashes identify observed installed source. Declared lock SRI authenticates the registry tarball only and is not proof of installed bytes, patch application, or generated Rollup output.',
    packageCount: records.packages.length,
    moduleCount:
      records.packages.reduce(
        (count, record) => count + record.modules.length,
        0,
      ) + records.unmappedModules.length,
    packages: records.packages.map(record => ({
      name: record.name,
      version: record.version,
      license: record.license,
      lockContext: record.lockContext,
      modules: record.modules,
      legalDocuments: record.legalDocuments.map(
        ({ contents: _contents, ...document }) => document,
      ),
      obligations: record.obligations,
    })),
    unmappedModules: records.unmappedModules,
    obligations: [
      ...records.packages.flatMap(record =>
        record.obligations.map(item => ({
          package: `${record.name}@${record.version}`,
          ...item,
        })),
      ),
      ...(records.unmappedModules.length
        ? [
            {
              code: 'unmapped-rollup-modules',
              count: records.unmappedModules.length,
              message:
                'Included Rollup modules could not be mapped to package metadata.',
            },
          ]
        : []),
    ],
  }
}

async function readLock(root, lockfilePath) {
  const lock = parseYaml(
    await fs.readFile(path.join(root, lockfilePath), 'utf8'),
  )
  if (!lock || typeof lock.packages !== 'object' || !lock.packages) {
    throw new Error(
      `Lockfile does not contain a packages graph: ${lockfilePath}`,
    )
  }
  return lock
}

async function stageRecords(
  records,
  { bundleId, lockfilePath, manifestName, outputRoot },
) {
  const docsDir = path.join(outputRoot, 'third-party-notices')
  await fs.mkdir(docsDir, { recursive: true })
  const outputDocuments = []
  for (const record of records.packages) {
    for (const document of record.legalDocuments) {
      const destination = path.join(outputRoot, document.outputPath)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, document.contents)
      outputDocuments.push({
        package: `${record.name}@${record.version}`,
        path: document.outputPath,
        sha256: document.sha256,
      })
    }
  }
  const inventory = serializeInventory(
    { ...records, lockfileVersion: records.lockfileVersion },
    { bundleId, lockfilePath },
  )
  inventory.outputDocuments = outputDocuments.sort((left, right) =>
    compareText(left.path, right.path),
  )
  const manifestPath = path.join(outputRoot, manifestName)
  await fs.writeFile(manifestPath, stableJson(inventory))
  inventory.inventoryFile = {
    path: manifestName,
    sha256: sha256(Buffer.from(stableJson(inventory))),
  }
  return inventory
}

export function includedModulesInventoryPlugin({
  bundleId = 'core-rollup',
  inventoryFile = 'THIRD-PARTY-NOTICES.json',
  lockfilePath = 'pnpm-lock.yaml',
  mode = 'emit',
  outputRoot,
  root,
} = {}) {
  const resolvedRoot = path.resolve(root)
  let generated
  return {
    name: `sea-provenance-${bundleId}`,
    async generateBundle(_options, bundle) {
      const moduleIds = new Set()
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          for (const id of Object.keys(output.modules)) {
            moduleIds.add(id)
          }
        }
      }
      const lock = await readLock(resolvedRoot, lockfilePath)
      const records = await collectPackageRecords(moduleIds, {
        root: resolvedRoot,
        lock,
      })
      records.lockfileVersion = lock.lockfileVersion
      const inventory = serializeInventory(records, { bundleId, lockfilePath })
      const assets = records.packages.flatMap(record => record.legalDocuments)
      if (mode === 'emit') {
        for (const document of assets) {
          this.emitFile({
            type: 'asset',
            fileName: document.outputPath,
            source: document.contents,
          })
        }
        this.emitFile({
          type: 'asset',
          fileName: inventoryFile,
          source: stableJson(inventory),
        })
      } else {
        generated = { records, inventory, assets }
      }
      generated ??= { records, inventory, assets }
    },
    async writeBundle(outputOptions) {
      if (mode !== 'stage' || !generated) {
        return
      }
      const destination =
        outputRoot ??
        path.resolve(
          outputOptions.dir ?? path.dirname(outputOptions.file ?? resolvedRoot),
        )
      await stageRecords(generated.records, {
        outputRoot: destination,
        manifestName: inventoryFile,
        bundleId,
        lockfilePath,
      })
    },
  }
}

export async function writeCopiedPackageInventory({
  bundleId,
  inventoryFile,
  lockfilePath = 'pnpm-lock.yaml',
  outputPackageRoot,
  outputRoot,
  packageName: _packageName,
  packageRoot,
  root,
}) {
  const resolvedRoot = path.resolve(root)
  const lock = await readLock(resolvedRoot, lockfilePath)
  const packageJsonPath = path.join(packageRoot, 'package.json')
  const metadata = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
  const resolvedPackageRoot = await fs.realpath(packageRoot)
  const lockContext = await lockContextFor(
    lock,
    metadata.name,
    metadata.version,
    resolvedRoot,
    resolvedPackageRoot,
  )
  const { files, skippedLinks } = await findLegalFiles(packageRoot)
  const slug = packageSlug(metadata.name, metadata.version, lockContext)
  const legalDocuments = []
  for (const file of files) {
    const contents = await fs.readFile(file.fullPath)
    const digest = sha256(contents)
    const relative = file.relativePath
      .split('/')
      .map(segment => segment.replace(/[^A-Za-z0-9._-]+/g, '_'))
      .join('/')
    const outputPath = `third-party-notices/${slug}/${relative}.${digest.slice(0, 12)}`
    const destination = path.join(outputRoot, outputPath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, contents)
    legalDocuments.push({
      packagePath: file.relativePath,
      outputPath,
      sha256: digest,
      type: /^(?:notice|copyright|patents?)/i.test(
        path.posix.basename(file.relativePath),
      )
        ? 'notice'
        : 'license',
    })
  }
  const filesInOutput = []
  const visit = async (directory, relativeDirectory = '') => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => compareText(a.name, b.name))) {
      const absolute = path.join(directory, entry.name)
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolute, relativePath)
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(absolute)
        const sourcePath = path.join(packageRoot, ...relativePath.split('/'))
        const sourceBytes = await fs.readFile(sourcePath).catch(error => {
          if (error?.code === 'ENOENT') {
            return undefined
          }
          throw error
        })
        filesInOutput.push({
          path: relativePath,
          outputSha256: sha256(bytes),
          ...(sourceBytes
            ? { sourceSha256: sha256(sourceBytes) }
            : { sourceSha256: null }),
          verification: 'unverified',
        })
      }
    }
  }
  await visit(outputPackageRoot)
  const obligations = []
  if (!legalDocuments.some(document => document.type === 'license')) {
    obligations.push({
      code: 'missing-license-text',
      message: 'No license text file was found in the copied package source.',
    })
  }
  if (skippedLinks.length) {
    obligations.push({
      code: 'unresolved-license-symlink',
      paths: skippedLinks.sort(compareText),
    })
  }
  const inventory = {
    schemaVersion: 1,
    generator: 'sea-copied-package-source-hashes',
    bundle: bundleId,
    lockfile: { path: lockfilePath, lockfileVersion: lock.lockfileVersion },
    sourceAuthentication: 'unverified',
    sourceAuthenticationReason:
      'Hashes identify installed package bytes and copied output. Declared lock SRI is not authentication of installed or patched files.',
    packageCount: 1,
    moduleCount: filesInOutput.filter(file => /\.m?js$/i.test(file.path))
      .length,
    packages: [
      {
        name: metadata.name,
        version: metadata.version,
        license: metadata.license ?? metadata.licenses ?? null,
        lockContext,
        files: filesInOutput,
        legalDocuments,
        obligations,
      },
    ],
    unmappedModules: [],
    obligations: obligations.map(item => ({
      package: `${metadata.name}@${metadata.version}`,
      ...item,
    })),
    outputDocuments: legalDocuments.map(document => ({
      package: `${metadata.name}@${metadata.version}`,
      path: document.outputPath,
      sha256: document.sha256,
    })),
  }
  const bytes = Buffer.from(stableJson(inventory))
  await fs.writeFile(path.join(outputRoot, inventoryFile), bytes)
  return {
    ...inventory,
    inventoryFile: { path: inventoryFile, sha256: sha256(bytes) },
  }
}
