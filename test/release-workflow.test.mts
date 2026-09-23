import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ReleaseStep {
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
}

interface ReleaseWorkflow {
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    land: { steps: ReleaseStep[] }
    verify: {
      environment?: string
      outputs: { sha: string }
      permissions: Record<string, string>
      steps: ReleaseStep[]
    }
    publish: {
      environment: string
      if: string
      permissions: Record<string, string>
      steps: ReleaseStep[]
    }
  }
  on: { workflow_dispatch: { inputs: Record<string, { default: unknown }> } }
}

const workflow = parse(
  readFileSync(
    new URL('../.github/workflows/publish-npm.yml', import.meta.url),
    'utf8',
  ),
) as ReleaseWorkflow

describe('v1 release workflow contract', () => {
  it('scopes both release App tokens to the current repository', () => {
    const mintSteps = Object.values(workflow.jobs)
      .flatMap(job => job.steps)
      .filter(step => step.run === 'node scripts/release/mint-app-token.mjs')
    expect(mintSteps).toHaveLength(2)
    for (const step of mintSteps) {
      expect(step.env).toMatchObject({
        PERMISSIONS: '{"contents":"write"}',
        REPOSITORIES: '${{ github.event.repository.name }}',
      })
    }
  })

  it('uses the migrated trusted publisher environment', () => {
    expect(workflow.jobs.publish.environment).toBe('publish-npm')
    expect(workflow.jobs.publish.permissions['id-token']).toBe('write')
  })

  it('serializes the release branch across dist-tags', () => {
    expect(workflow.concurrency).toEqual({
      group: 'npm-publish-${{ github.repository }}-${{ github.ref }}',
      'cancel-in-progress': false,
    })
  })

  it('keeps registry credentials out of verification and defaults to dry run', () => {
    expect(workflow.jobs.verify.environment).toBeUndefined()
    expect(workflow.jobs.verify.permissions['id-token']).toBeUndefined()
    expect(workflow.on.workflow_dispatch.inputs['dry-run']?.default).toBe(true)
    expect(workflow.jobs.publish.if).toBe('${{ inputs.dry-run == false }}')
  })

  it('retains bump metadata when verification fails', () => {
    expect(workflow.jobs.verify.outputs.sha).toBe(
      '${{ steps.release-meta.outputs.sha || steps.bump.outputs.sha }}',
    )
  })

  it('keeps publishing free of checkout, install, build, and action code', () => {
    expect(
      workflow.jobs.publish.steps.every(step => step.uses === undefined),
    ).toBe(true)
    expect(workflow.jobs.publish.steps.map(step => step.name)).not.toContain(
      'Checkout source',
    )
    expect(workflow.jobs.publish.steps.map(step => step.name)).not.toContain(
      'Install dependencies',
    )
    expect(workflow.jobs.publish.steps.map(step => step.name)).not.toContain(
      'Build',
    )
  })

  it('checks registry availability through the release preflight entry', () => {
    const preflight = workflow.jobs.verify.steps.find(
      step => step.name === 'Refuse an already-published version',
    )
    expect(preflight?.run).toBe(
      'pnpm run release:preflight --version "$VERSION"',
    )
  })
})
