/**
 * @fileoverview Patch application utilities for Node.js source modifications
 */

import { existsSync, promises as fs, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from './core.mjs'

/**
 * Parse unified diff patch format
 */
export function parsePatch(patchContent) {
  const files = []
  let currentFile = null
  let currentHunk = null

  const lines = patchContent.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('--- ')) {
      // Start of new file
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk)
      }
      if (currentFile) {
        files.push(currentFile)
      }

      const fromMatch = line.match(/^---\s+(?:a\/)?(.+?)(?:\s|$)/)
      currentFile = {
        from: fromMatch ? fromMatch[1] : '',
        to: '',
        hunks: []
      }
      currentHunk = null
    } else if (line.startsWith('+++ ')) {
      const toMatch = line.match(/^\+\+\+\s+(?:b\/)?(.+?)(?:\s|$)/)
      if (currentFile) {
        currentFile.to = toMatch ? toMatch[1] : ''
      }
    } else if (line.startsWith('@@')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk)
      }

      const hunkMatch = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4] || '1'),
          lines: []
        }
      }
    } else if (currentHunk) {
      currentHunk.lines.push(line)
    }
  }

  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk)
  }
  if (currentFile) {
    files.push(currentFile)
  }

  return files
}

/**
 * Apply hunks to a file
 */
export async function applyPatchToFile(filePath, hunks) {
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split('\n')

  for (const hunk of hunks) {
    let oldLineNum = hunk.oldStart - 1
    let offset = 0

    for (const line of hunk.lines) {
      const actualLine = oldLineNum + offset

      if (line.startsWith('-')) {
        // Remove line
        lines.splice(actualLine, 1)
        offset--
      } else if (line.startsWith('+')) {
        // Add line
        lines.splice(actualLine, 0, line.substring(1))
        offset++
      } else {
        // Context line - verify it matches
        if (lines[actualLine] !== line.substring(1)) {
          throw new Error(`Context mismatch at line ${actualLine + 1}`)
        }
        oldLineNum++
      }
    }
  }

  await fs.writeFile(filePath, lines.join('\n'))
}

/**
 * Apply a patch file (cross-platform)
 */
export async function applyPatch(patchPath, targetDir, description) {
  logger.log(`🩹 Applying ${description}...`)
  logger.log(`   Patch: ${patchPath}`)

  try {
    const patchContent = await fs.readFile(patchPath, 'utf8')
    const files = parsePatch(patchContent)

    let successCount = 0
    for (const file of files) {
      const filePath = path.join(targetDir, file.to)

      if (!existsSync(filePath)) {
        logger.log(`   ${colors.yellow('⚠')}  File not found: ${file.to}`)
        continue
      }

      try {
        await applyPatchToFile(filePath, file.hunks) // eslint-disable-line no-await-in-loop
        successCount++
        logger.log(`   ${colors.green('✓')} Patched ${file.to}`)
      } catch (error) {
        logger.log(`   ${colors.red('✗')} Failed to patch ${file.to}: ${error.message}`)
      }
    }

    if (successCount === files.length) {
      logger.success(` ${description} applied successfully`)
      return true
    } else if (successCount > 0) {
      logger.warn(`  ${description} partially applied (${successCount}/${files.length} files)`)
      return false
    } else {
      logger.error(`  ${description} failed to apply`)
      return false
    }
  } catch (error) {
    logger.error(`  Failed to apply patch: ${error.message}`)
    return false
  }
}

/**
 * Find yao-pkg patch for Node version
 */
export async function findYaoPkgPatch(nodeVersion) {
  try {
    const pkgPath = path.dirname(await import.meta.resolve('@yao-pkg/pkg'))
    const patchesDir = path.join(pkgPath, '..', 'patches')

    if (!existsSync(patchesDir)) {
      return null
    }

    const versionWithoutV = nodeVersion.startsWith('v') ? nodeVersion.substring(1) : nodeVersion
    const patchFile = `node.v${versionWithoutV}.cpp.patch`
    const patchPath = path.join(patchesDir, patchFile)

    return existsSync(patchPath) ? patchPath : null
  } catch {
    return null
  }
}

/**
 * Apply version-specific fixes
 */
export async function applyVersionSpecificFixes(targetDir, nodeVersion, buildConfig, customPatchesDir) {
  logger.log('\n🔧 Checking for version-specific fixes...')

  const versionConfig = buildConfig?.node?.versions?.[nodeVersion]
  if (!versionConfig) {
    logger.log(`   No specific fixes configured for ${nodeVersion}`)
    return
  }

  if (versionConfig.issues?.v8_include_paths) {
    const issue = versionConfig.issues.v8_include_paths
    logger.log(`   ${issue.description}`)

    const patchFile = issue.patch
    if (patchFile) {
      const patchPath = path.join(customPatchesDir, patchFile)
      if (existsSync(patchPath)) {
        const success = await applyPatch(patchPath, targetDir, 'V8 include path fix')
        if (!success && issue.required) {
          logger.warn('Required patch failed - build will likely fail!')
        }
      } else {
        logger.log(`   ${colors.yellow('⚠')}  Patch file not found: ${patchFile}`)
        if (issue.required) {
          logger.warn('   This patch is required for successful build!')
        }
      }
    }
  }

  if (versionConfig.notes) {
    logger.log(`   Note: ${versionConfig.notes}`)
  }
}

/**
 * Apply custom patches from directory
 */
export async function applyCustomPatches(targetDir, customPatchesDir) {
  if (!existsSync(customPatchesDir)) {
    logger.log(`📂 No custom patches directory found at ${customPatchesDir}`)
    return
  }

  const patchFiles = readdirSync(customPatchesDir)
    .filter(file => file.endsWith('.patch'))
    .filter(file => !file.includes('-v24.patch'))
    .sort()

  if (patchFiles.length === 0) {
    logger.log('📂 No custom patches found')
    return
  }

  logger.log(`\n📋 Found ${patchFiles.length} custom patches to apply`)

  for (const patchFile of patchFiles) {
    const patchPath = path.join(customPatchesDir, patchFile)
    await applyPatch(patchPath, targetDir, `Custom patch: ${patchFile}`) // eslint-disable-line no-await-in-loop
    logger.log("")
  }
}

/**
 * Apply code modifications based on configuration
 */
export async function applyCodeModifications(nodeDir, nodeVersion, customPatchesDir) {
  const codeModsPath = path.join(customPatchesDir, 'code-mods.json')

  if (!existsSync(codeModsPath)) {
    return applyLegacyCodeModifications(nodeDir)
  }

  logger.log('\n🔧 Applying configured code modifications...')

  const config = JSON.parse(readFileSync(codeModsPath, 'utf8'))
  let appliedCount = 0

  for (const [modName, mod] of Object.entries(config.mods)) {
    if (!mod.enabled) {
      continue
    }

    if (mod.versions && !mod.versions.includes(nodeVersion)) {
      logger.log(`   ⏭️  Skipping ${modName} (not for ${nodeVersion})`)
      continue
    }

    logger.log(`   Applying: ${mod.description}`)

    try {
      switch (mod.type) {
        case 'patch': {
          const patchFile = path.join(customPatchesDir, mod.file)
          if (existsSync(patchFile)) {
            const success = await applyPatch(patchFile, nodeDir, modName) // eslint-disable-line no-await-in-loop
            if (success) {appliedCount++}
          } else {
            logger.log(`     ${colors.yellow('⚠')}  Patch file not found: ${mod.file}`)
          }
          break
        }

        case 'replace': {
          for (const fileConfig of mod.files) {
            const filePath = path.join(nodeDir, fileConfig.path)
            if (existsSync(filePath)) {
              let content = await fs.readFile(filePath, 'utf8') // eslint-disable-line no-await-in-loop
              let modified = false

              for (const replacement of fileConfig.replacements) {
                if (content.includes(replacement.search)) {
                  content = content.replace(
                    new RegExp(replacement.search, 'g'),
                    replacement.replace
                  )
                  modified = true
                }
              }

              if (modified) {
                await fs.writeFile(filePath, content) // eslint-disable-line no-await-in-loop
                logger.log(`     ${colors.green('✓')} Modified ${fileConfig.path}`)
                appliedCount++
              }
            }
          }
          break
        }

        case 'append': {
          for (const fileConfig of mod.files) {
            const filePath = path.join(nodeDir, fileConfig.path)
            if (existsSync(filePath)) {
              const content = await fs.readFile(filePath, 'utf8') // eslint-disable-line no-await-in-loop
              const data = JSON.parse(content)

              if (fileConfig.section === 'variables') {
                if (!data.variables) {data.variables = {}}
                if (!data.variables[fileConfig.section]) {
                  data.variables[fileConfig.section] = []
                }

                data.variables[fileConfig.section].push(...fileConfig.values)

                await fs.writeFile(filePath, JSON.stringify(data, null, 2)) // eslint-disable-line no-await-in-loop
                logger.log(`     ${colors.green('✓')} Updated ${fileConfig.path}`)
                appliedCount++
              }
            }
          }
          break
        }
      }
    } catch (error) {
      logger.log(`     ${colors.red('✗')} Failed to apply ${modName}: ${error.message}`)
    }
  }

  logger.success(` Applied ${appliedCount} code modifications`)
}

/**
 * Legacy inline code modifications (fallback)
 */
export async function applyLegacyCodeModifications(nodeDir) {
  logger.log('\n🔧 Applying legacy code modifications...')

  const v8FlagsFile = path.join(nodeDir, 'src', 'node_contextify.cc')
  if (existsSync(v8FlagsFile)) {
    logger.log('   Modifying V8 flags (kAllowHarmonyDynamicImport: 1 → 0)...')

    let content = readFileSync(v8FlagsFile, 'utf8')
    if (content.includes('kAllowHarmonyDynamicImport, 1')) {
      content = content.replace(
        /kAllowHarmonyDynamicImport,\s*1/g,
        'kAllowHarmonyDynamicImport, 0'
      )
      await fs.writeFile(v8FlagsFile, content)
      logger.log('   ✅ V8 flags modified')
    } else {
      logger.log('   ⚠️  V8 flags pattern not found')
    }
  }

  logger.success(' Legacy modifications complete')
}
