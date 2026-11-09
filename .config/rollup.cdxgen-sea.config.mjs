/** Bundle the cdxgen API for offline execution from the Node SEA VFS. */
/* eslint-disable no-await-in-loop -- VFS staging writes shared paths in dependency order. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import commonjsPlugin from '@rollup/plugin-commonjs'
import jsonPlugin from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { parse as parseYaml } from 'yaml'

const root = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
)
const curatedLegalRoot = path.join(root, 'src/sea/licenses/cdxgen-third-party')

const curatedLegalDocuments = {
  'boolbase@1.0.0': [
    {
      filename: 'boolbase-1.0.0-ISC.txt',
      kind: 'license',
      sourcePath: 'LICENSE (upstream file; omitted from npm tarball)',
      authority:
        'https://github.com/fb55/boolbase/blob/be0bcd8a4e917a0a5895e95b523fbbed05a64871/LICENSE',
    },
  ],
  'err-code@2.0.3': [
    {
      filename: 'err-code-2.0.3-MIT.txt',
      kind: 'license',
      sourcePath:
        'MIT license (npm package README declares MIT; package author used for copyright attribution)',
      authority:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt',
      attributionSource:
        'https://raw.githubusercontent.com/IndigoUnited/js-err-code/92511d41a6a926c94c9d11493404867b1e92a77/README.md',
      attributionInferredFrom:
        'npm package author field (IndigoUnited); upstream v2.0.3 README declares MIT but no copyright line or license file.',
    },
    {
      filename: 'err-code-2.0.3-README.md',
      kind: 'notice',
      sourcePath: 'README.md (published npm package; lock SRI verified)',
      authority: 'https://registry.npmjs.org/err-code/2.0.3',
    },
  ],
  'imurmurhash@0.1.4': [
    {
      filename: 'imurmurhash-0.1.4-MIT.txt',
      kind: 'license',
      sourcePath: 'LICENSE (upstream file; omitted from npm tarball)',
      authority: 'https://github.com/jensyt/imurmurhash-js/blob/0.1.4/LICENSE',
    },
  ],
  'spdx-exceptions@2.5.0': [
    {
      filename: 'spdx-exceptions-2.5.0-CC-BY-3.0.txt',
      kind: 'license',
      sourcePath: 'CC-BY-3.0 legal code (npm README declares CC-BY-3.0)',
      authority:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/CC-BY-3.0.txt',
    },
    {
      filename: 'spdx-exceptions-2.5.0-README.md',
      kind: 'notice',
      sourcePath: 'README.md (published npm package; lock SRI verified)',
      authority: 'https://registry.npmjs.org/spdx-exceptions/2.5.0',
    },
  ],
  'spdx-license-ids@3.0.22': [
    {
      filename: 'spdx-license-ids-3.0.22-CC0-1.0.txt',
      kind: 'license',
      sourcePath: 'CC0-1.0 legal code (npm README declares CC0-1.0)',
      authority:
        'https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/CC0-1.0.txt',
    },
    {
      filename: 'spdx-license-ids-3.0.22-README.md',
      kind: 'notice',
      sourcePath: 'README.md (published npm package; lock SRI verified)',
      authority: 'https://registry.npmjs.org/spdx-license-ids/3.0.22',
    },
  ],
}

const legalFilenamePattern =
  /^(?:license|licence|copying|copyright|notice|patents?)(?:[._ -].*)?$/i

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function safePart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_') || 'unknown'
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
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
      const relativePath = path.posix.join(
        relativeDirectory.split(path.sep).join('/'),
        entry.name,
      )
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          await visit(fullPath, path.join(relativeDirectory, entry.name))
        }
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

function thirdPartyNoticePlugin() {
  return {
    name: 'sea-cdxgen-third-party-notices',
    async generateBundle() {
      const packages = new Map()
      const sourceModules = new Map()
      const unmappedModuleCount = { count: 0 }
      const lock = parseYaml(
        await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
      )
      if (!lock || typeof lock.packages !== 'object' || !lock.packages) {
        throw new Error('pnpm-lock.yaml does not contain a packages graph')
      }
      const lockPackages = lock.packages
      const patchedDependencies = lock.patchedDependencies ?? {}
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) {
          continue
        }
        const rawPath = id.startsWith('file:')
          ? url.fileURLToPath(id)
          : id.split('?')[0]
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
        const packageInfo = await findPackageRoot(modulePath)
        if (!packageInfo) {
          unmappedModuleCount.count += 1
          const moduleDigest = sha256(await fs.readFile(modulePath))
          sourceModules.set(modulePath, {
            sourcePath: `unmapped/${path.basename(modulePath)}-${moduleDigest.slice(0, 12)}`,
            sha256: moduleDigest,
            package: null,
            verification: 'unverified',
            verificationReason:
              'No package metadata root was found for this Rollup module.',
          })
          continue
        }
        const { directory, metadata } = packageInfo
        const lockKeyCandidates = Object.keys(lockPackages)
          .filter(
            key =>
              key === `${metadata.name}@${metadata.version}` ||
              key.startsWith(`${metadata.name}@${metadata.version}(`),
          )
          .sort(compareText)
        const lockKey =
          lockKeyCandidates.length === 1 ? lockKeyCandidates[0] : null
        const lockRecord = lockKey ? lockPackages[lockKey] : null
        const lockContexts = lockKeyCandidates.map(candidate => ({
          packageKey: candidate,
          resolution: lockPackages[candidate]?.resolution ?? null,
        }))
        const patch =
          patchedDependencies[`${metadata.name}@${metadata.version}`] ?? null
        const instancePath =
          lockKey ??
          (lockKeyCandidates.length
            ? `ambiguous:${lockKeyCandidates.join('|')}`
            : `${metadata.name}@${metadata.version}:missing-lock-entry`)
        const key = `${metadata.name}@${metadata.version}\0${instancePath}`
        let record = packages.get(key)
        if (!record) {
          record = {
            packageName: metadata.name,
            version: metadata.version,
            instancePath,
            lockKey,
            lockContexts,
            lockResolution: lockRecord?.resolution ?? null,
            patch: patch
              ? { path: patch.path ?? null, hash: patch.hash ?? null }
              : null,
            curatedLegalDocuments:
              curatedLegalDocuments[`${metadata.name}@${metadata.version}`] ??
              [],
            license: null,
            licenseDeclarations: new Map(),
            roots: new Map(),
            moduleCount: 0,
            obligations: [],
          }
          packages.set(key, record)
        }
        const licenseDeclaration = metadata.license ?? metadata.licenses ?? null
        record.licenseDeclarations.set(
          JSON.stringify(licenseDeclaration),
          licenseDeclaration,
        )
        const declarationValues = [...record.licenseDeclarations.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([, value]) => value)
        record.license =
          declarationValues.length === 1
            ? declarationValues[0]
            : declarationValues
        record.moduleCount += 1
        const relativeModulePath = path
          .relative(directory, modulePath)
          .split(path.sep)
          .join('/')
        sourceModules.set(modulePath, {
          sourcePath: `${instancePath}/${relativeModulePath}`,
          package: `${metadata.name}@${metadata.version}`,
          packageInstance: instancePath,
          packagePath: relativeModulePath,
          sha256: sha256(await fs.readFile(modulePath)),
          lockPackageKey: lockKey,
          lockPackageCandidates: lockContexts,
          lockResolution: lockRecord?.resolution ?? null,
          declaredLockIntegrity: lockRecord?.resolution?.integrity ?? null,
          patch: patch
            ? { path: patch.path ?? null, hash: patch.hash ?? null }
            : null,
          verification: 'unverified',
          verificationReason:
            'Installed module bytes were hashed but not authenticated against locked tarball or patch output; declared lock integrity does not verify generated bundle bytes.',
        })
        if (!record.roots.has(directory)) {
          const { files, skippedLinks } = await findLegalFiles(directory)
          record.roots.set(directory, { files, skippedLinks })
        }
      }

      const inventory = {
        schemaVersion: 1,
        generator: 'rollup-module-closure',
        packages: [],
        unmappedModuleCount: unmappedModuleCount.count,
        obligations: [],
      }
      const sourceInventory = {
        schemaVersion: 1,
        generator: 'rollup-module-source-hashes',
        lockfile: {
          path: 'pnpm-lock.yaml',
          lockfileVersion: lock.lockfileVersion,
        },
        verification: 'unverified',
        verificationReason:
          'Hashes identify installed module source files. Declared lock SRI is metadata only and does not authenticate installed, patched, or generated bundle bytes.',
        modules: [...sourceModules.values()].sort((left, right) =>
          compareText(left.sourcePath, right.sourcePath),
        ),
      }
      const sourceInventoryJson = `${JSON.stringify(sourceInventory, null, 2)}\n`
      const sourceInventorySha256 = sha256(Buffer.from(sourceInventoryJson))
      this.emitFile({
        type: 'asset',
        fileName: 'ROLLUP-SOURCE-INVENTORY.json',
        source: sourceInventoryJson,
      })
      inventory.sourceInventory = {
        path: 'tools/cdxgen/ROLLUP-SOURCE-INVENTORY.json',
        sha256: sourceInventorySha256,
        moduleCount: sourceModules.size,
        verification: 'unverified',
      }
      if (unmappedModuleCount.count > 0) {
        inventory.obligations.push({
          code: 'unmapped-rollup-modules',
          count: unmappedModuleCount.count,
          message:
            'Some bundled node_modules modules could not be mapped to package metadata.',
        })
      }

      for (const record of [...packages.values()].sort((left, right) =>
        compareText(
          `${left.packageName}@${left.version}\0${left.instancePath}`,
          `${right.packageName}@${right.version}\0${right.instancePath}`,
        ),
      )) {
        if (record.licenseDeclarations.size > 1) {
          record.obligations.push({
            code: 'conflicting-license-declarations',
            message:
              'The same package name and version resolved with different license declarations.',
          })
        }
        if (
          record.curatedLegalDocuments.some(
            document => document.attributionInferredFrom,
          )
        ) {
          record.obligations.push({
            code: 'inferred-copyright-attribution',
            message: record.curatedLegalDocuments.find(
              document => document.attributionInferredFrom,
            ).attributionInferredFrom,
          })
        }
        const licenseIsString =
          typeof record.license === 'string' && record.license.trim() !== ''
        if (!licenseIsString) {
          record.obligations.push({
            code: record.license
              ? 'ambiguous-license-declaration'
              : 'missing-license-declaration',
            message:
              'package.json does not provide one unambiguous nonempty license string.',
          })
        }
        if (
          Array.isArray(record.license) ||
          (record.license && typeof record.license === 'object')
        ) {
          record.obligations.push({
            code: 'ambiguous-license-declaration-format',
            message:
              'The license declaration is structured or deprecated and requires review.',
          })
        }

        const id = `${record.packageName}@${record.version}\0${record.instancePath}`
        const packageSlug = `${safePart(record.packageName)}-${safePart(record.version)}-${sha256(Buffer.from(id)).slice(0, 12)}`
        const stagedFiles = new Map()
        const skippedLinks = []
        for (const { files, skippedLinks: links } of record.roots.values()) {
          skippedLinks.push(...links)
          for (const file of files) {
            const contents = await fs.readFile(file.fullPath)
            const digest = sha256(contents)
            const relativePath = file.relativePath.split(path.sep).join('/')
            const sourcePath = path.posix.parse(relativePath)
            const contentAddressedName = `${sourcePath.name}.${digest.slice(0, 12)}${sourcePath.ext}`
            const outputPath = `notices/${packageSlug}/${sourcePath.dir ? `${sourcePath.dir}/` : ''}${contentAddressedName}`
            stagedFiles.set(outputPath, {
              contents,
              sha256: digest,
              relativePath,
            })
          }
        }

        // Several published npm tarballs omit the license text even though
        // package.json declares a license. Include version-pinned authoritative
        // texts and attribution material collected during the SEA audit.
        for (const document of record.curatedLegalDocuments) {
          const contents = await fs.readFile(
            path.join(curatedLegalRoot, document.filename),
          )
          const digest = sha256(contents)
          const outputPath = `notices/${packageSlug}/${document.filename}`
          stagedFiles.set(outputPath, {
            contents,
            sha256: digest,
            relativePath: document.sourcePath,
            kind: document.kind,
            authority: document.authority,
            ...(document.attributionSource
              ? { attributionSource: document.attributionSource }
              : {}),
            ...(document.attributionInferredFrom
              ? { attributionInferredFrom: document.attributionInferredFrom }
              : {}),
          })
        }

        const licenseFiles = []
        const noticeFiles = []
        for (const [outputPath, file] of [...stagedFiles].sort(([a], [b]) =>
          compareText(a, b),
        )) {
          this.emitFile({
            type: 'asset',
            fileName: outputPath,
            source: file.contents,
          })
          const reference = {
            path: `tools/cdxgen/${outputPath}`,
            sourcePath: file.relativePath,
            sha256: file.sha256,
            ...(file.authority
              ? {
                  source: file.authority,
                  ...(file.attributionSource
                    ? { attributionSource: file.attributionSource }
                    : {}),
                  ...(file.attributionInferredFrom
                    ? { attributionInferredFrom: file.attributionInferredFrom }
                    : {}),
                }
              : {}),
          }
          const basename = path.posix.basename(file.relativePath)
          if (
            file.kind === 'notice' ||
            /^(?:notice|copyright|patents?)/i.test(basename)
          ) {
            noticeFiles.push(reference)
          } else {
            licenseFiles.push(reference)
          }
        }
        if (licenseFiles.length === 0) {
          record.obligations.push({
            code: 'missing-license-text',
            message:
              'No license text file was found in the resolved package tree.',
          })
        }
        if (skippedLinks.length > 0) {
          record.obligations.push({
            code: 'unresolved-license-symlink',
            paths: [...new Set(skippedLinks)].sort(compareText),
            message:
              'A license or notice symlink was not followed when collecting package texts.',
          })
        }
        const packageRecord = {
          name: record.packageName,
          version: record.version,
          instancePath: record.instancePath,
          lockPackageKey: record.lockKey,
          lockContexts: record.lockContexts,
          patch: record.patch,
          license: record.license,
          moduleCount: record.moduleCount,
          licenseFiles,
          noticeFiles,
          obligations: record.obligations,
        }
        inventory.packages.push(packageRecord)
        for (const obligation of record.obligations) {
          inventory.obligations.push({
            package: `${record.packageName}@${record.version}`,
            ...obligation,
          })
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.json',
        source: `${JSON.stringify(inventory, null, 2)}\n`,
      })
    },
  }
}

export default {
  input:
    process.env.SEA_CDXGEN_INPUT ||
    path.join(root, 'node_modules/@cyclonedx/cdxgen/lib/cli/index.js'),
  output: {
    dir:
      process.env.SEA_CDXGEN_OUTPUT || path.join(root, 'dist/sea-cdxgen-api'),
    format: 'es',
    entryFileNames: 'lib/cli/index.js',
    chunkFileNames: 'lib/cli/chunks/[name]-[hash].js',
    assetFileNames: 'lib/cli/assets/[name]-[hash][extname]',
  },
  external: id => id.startsWith('node:'),
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    jsonPlugin(),
    commonjsPlugin(),
    thirdPartyNoticePlugin(),
  ],
}
