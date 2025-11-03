import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

function findTestFiles(dir, files = []) {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      findTestFiles(fullPath, files)
    } else if (entry.endsWith('.test.mts')) {
      files.push(fullPath)
    }
  }
  return files
}

const testFiles = findTestFiles('test/unit')

for (const testFile of testFiles) {
  const content = readFileSync(testFile, 'utf-8')
  const testDir = dirname(testFile)

  // Calculate relative path from test file to src directory
  const relativeToSrc = relative(testDir, 'src')

  let modified = content

  // Calculate the mirrored source directory
  const testRelPath = testFile.replace('test/unit/', '').replace(/\.test\.mts$/, '.mts')
  const srcFilePath = join('src', testRelPath)
  const srcFileDir = dirname(srcFilePath)

  // Calculate relative path from test dir to src file dir
  const relativeToSrcDir = relative(testDir, srcFileDir)

  // Fix imports like './foo.mts' or './subdir/foo.mts'
  modified = modified.replace(/from '\.\/([^']+)'/g, (match, path) => {
    // If importing a file in the same logical directory
    if (!path.includes('/')) {
      // Same directory: test/unit/utils/yarn/paths.test.mts -> src/utils/yarn/paths.mts
      return `from '${relativeToSrcDir}/${path}'`
    } else {
      // Subdirectory: might be relative to src root
      return `from '${relativeToSrc}/${path}'`
    }
  })

  // Fix dynamic imports
  modified = modified.replace(/import\('\.\/([^']+)'\)/g, (match, path) => {
    if (!path.includes('/')) {
      return `import('${relativeToSrcDir}/${path}')`
    } else {
      return `import('${relativeToSrc}/${path}')`
    }
  })

  if (modified !== content) {
    writeFileSync(testFile, modified)
    console.log(`Fixed: ${testFile}`)
  }
}

console.log('Done!')
