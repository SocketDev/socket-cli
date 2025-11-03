import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Find all unit test files recursively.
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
  const lines = content.split('\n')
  const newLines = []

  for (const line of lines) {
    let newLine = line

    // Match import statements with relative paths.
    const importMatch = line.match(/from ['"](\.[^'"]+)['"]/);

    if (importMatch) {
      const importPath = importMatch[1]

      // Skip if already pointing to test/ helpers.
      if (importPath.includes('/test/')) {
        newLines.push(line)
        continue
      }

      // Get the directory of the test file relative to test/unit.
      const testRelativePath = testFile.replace('test/unit/', '')
      const testDir = dirname(testRelativePath)
      const depth = testDir === '.' ? 0 : testDir.split('/').length

      // If it's a same-directory import (./foo), convert to src path.
      if (importPath.startsWith('./')) {
        const srcPath = testDir === '.' ? '' : testDir + '/'
        const fileName = importPath.slice(2)

        // Build relative path back to src.
        const upLevels = '../'.repeat(depth + 2) // +2 for test/unit
        const newImportPath = `${upLevels}src/${srcPath}${fileName}`
        newLine = line.replace(importPath, newImportPath)
      }
      // If it's importing from ../ (sibling or parent in src), add more levels.
      else if (importPath.startsWith('../')) {
        // Count existing ../ levels.
        const upCount = (importPath.match(/\.\.\//g) || []).length

        // Need to add 2 more levels for test/unit.
        const newImportPath = '../'.repeat(upCount + 2) + importPath.slice(upCount * 3) + (importPath.includes('/src/') ? '' : 'src/')

        // Actually, simpler: if it doesn't start with ../../src/, add ../.. to beginning.
        if (!importPath.startsWith('../../src/')) {
          const addLevels = depth === 0 ? 2 : depth + 2
          const prefix = '../'.repeat(addLevels)

          // Extract the part after ../
          let pathPart = importPath
          let existingLevels = 0
          while (pathPart.startsWith('../')) {
            pathPart = pathPart.slice(3)
            existingLevels++
          }

          newLine = line.replace(importPath, `${prefix}src/${pathPart}`)
        }
      }
    }

    newLines.push(newLine)
  }

  writeFileSync(testFile, newLines.join('\n'))
}

console.log(`Fixed ${testFiles.length} test files`)
