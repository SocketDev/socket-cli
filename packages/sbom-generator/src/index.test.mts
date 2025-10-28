/**
 * SBOM Generator Tests
 */

import { describe, expect, it } from 'vitest'
import { generateSbom } from './index.mts'

describe('generateSbom', () => {
  it('should generate SBOM for npm project', async () => {
    // Test with socket-cli project.
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath, {
      includeDevDependencies: false,
    })

    // Validate SBOM structure.
    expect(sbom.bomFormat).toBe('CycloneDX')
    expect(sbom.specVersion).toBe('1.5')
    expect(sbom.serialNumber).toMatch(/^urn:uuid:/)
    expect(sbom.version).toBe(1)

    // Validate metadata.
    expect(sbom.metadata).toBeDefined()
    expect(sbom.metadata?.timestamp).toBeDefined()
    expect(sbom.metadata?.tools).toHaveLength(1)
    expect(sbom.metadata?.tools?.[0].vendor).toBe('Socket.dev')
    expect(sbom.metadata?.tools?.[0].name).toBe(
      '@socketsecurity/sbom-generator',
    )

    // Validate main component.
    expect(sbom.metadata?.component).toBeDefined()
    expect(sbom.metadata?.component?.type).toBe('application')
    expect(sbom.metadata?.component?.name).toBeDefined()
    expect(sbom.metadata?.component?.version).toBeDefined()

    // Validate components.
    expect(sbom.components).toBeDefined()
    expect(sbom.components!.length).toBeGreaterThan(0)

    // Validate dependencies.
    expect(sbom.dependencies).toBeDefined()
    expect(sbom.dependencies!.length).toBeGreaterThan(0)
  })

  it('should limit to specific ecosystems', async () => {
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath, {
      ecosystems: ['npm'],
      includeDevDependencies: false,
    })

    expect(sbom.components).toBeDefined()
    expect(sbom.components!.length).toBeGreaterThan(0)
  })

  it('should throw error for unsupported projects', async () => {
    await expect(generateSbom('/non-existent-path')).rejects.toThrow(
      'No supported ecosystems detected',
    )
  })

  it('should deduplicate components', async () => {
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath)

    const bomRefs = new Set<string>()
    for (const component of sbom.components || []) {
      const ref = component['bom-ref']
      if (ref) {
        expect(bomRefs.has(ref)).toBe(false)
        bomRefs.add(ref)
      }
    }
  })

  it('should include external references', async () => {
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath)

    const mainComponent = sbom.metadata?.component
    expect(mainComponent?.externalReferences).toBeDefined()
  })

  it('should generate valid serial number', async () => {
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath)

    expect(sbom.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('should generate timestamp in ISO 8601 format', async () => {
    const projectPath = process.cwd()
    const sbom = await generateSbom(projectPath)

    const timestamp = sbom.metadata?.timestamp
    expect(timestamp).toBeDefined()
    expect(() => new Date(timestamp!)).not.toThrow()
  })
})
