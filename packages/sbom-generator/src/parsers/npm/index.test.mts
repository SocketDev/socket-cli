/**
 * npm Parser Tests
 */

import { describe, expect, it } from 'vitest'
import { NpmParser } from './index.mts'

describe('NpmParser', () => {
  const parser = new NpmParser()

  it('should have correct ecosystem', () => {
    expect(parser.ecosystem).toBe('npm')
  })

  it('should detect npm projects with package.json', async () => {
    // Test with socket-cli project (current directory has package.json).
    const projectPath = process.cwd()
    const canDetect = await parser.detect(projectPath)
    expect(canDetect).toBe(true)
  })

  it('should not detect projects without package.json', async () => {
    // Test with non-existent directory.
    const canDetect = await parser.detect('/non-existent-path')
    expect(canDetect).toBe(false)
  })

  it('should parse npm project and generate components', async () => {
    // Test with socket-cli project.
    const projectPath = process.cwd()
    const result = await parser.parse(projectPath, {
      includeDevDependencies: false,
    })

    expect(result.ecosystem).toBe('npm')
    expect(result.metadata.name).toBeDefined()
    expect(result.metadata.version).toBeDefined()
    expect(result.components.length).toBeGreaterThan(0)
    expect(result.dependencies.length).toBeGreaterThan(0)

    // Validate component structure.
    const firstComponent = result.components[0]
    expect(firstComponent).toHaveProperty('type')
    expect(firstComponent).toHaveProperty('name')
    expect(firstComponent).toHaveProperty('version')
    expect(firstComponent).toHaveProperty('purl')
    expect(firstComponent['bom-ref']).toMatch(/^pkg:npm\//)

    // Validate dependency structure.
    const firstDep = result.dependencies[0]
    expect(firstDep).toHaveProperty('ref')
    expect(firstDep.ref).toMatch(/^pkg:npm\//)
  })

  it('should handle projects with dev dependencies', async () => {
    const projectPath = process.cwd()
    const withDev = await parser.parse(projectPath, {
      includeDevDependencies: true,
    })
    const withoutDev = await parser.parse(projectPath, {
      includeDevDependencies: false,
    })

    // With dev dependencies should have more components.
    expect(withDev.components.length).toBeGreaterThanOrEqual(
      withoutDev.components.length,
    )
  })
})
