import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ReleaseStep {
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
}

interface ReleaseJob {
  if?: string
  needs?: string | string[]
  permissions: Record<string, string>
  steps: ReleaseStep[]
}

interface ReleaseWorkflow {
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: {
    derive: ReleaseJob
    'release-pr': ReleaseJob
    verify: {
      if: string
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
  it('mints the release App token only in the job that installs nothing', () => {
    const mintingJobs = Object.entries(workflow.jobs)
      .filter(({ 1: job }) =>
        job.steps.some(
          step => step.run === 'node scripts/release/mint-app-token.mjs',
        ),
      )
      .map(({ 0: name }) => name)
    expect(mintingJobs).toEqual(['release-pr'])
    const mint = workflow.jobs['release-pr'].steps.find(
      step => step.run === 'node scripts/release/mint-app-token.mjs',
    )
    expect(mint?.env).toMatchObject({
      PERMISSIONS: '{"contents":"write","pull_requests":"write"}',
      REPOSITORIES: '${{ github.event.repository.name }}',
    })
    expect(
      workflow.jobs['release-pr'].steps.map(step => step.name),
    ).not.toContain('Install dependencies')
  })

  it('never writes to the release line from the workflow', () => {
    const scripts = Object.values(workflow.jobs)
      .flatMap(job => job.steps)
      .map(step => step.run ?? '')
    expect(scripts.join('\n')).not.toMatch(/promote\.mts|git push/)
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      'derive',
      'publish',
      'release-pr',
      'verify',
    ])
  })

  it('routes each mode to its own jobs and keeps dry runs write-free', () => {
    expect(workflow.on.workflow_dispatch.inputs['mode']?.default).toBe(
      'publish',
    )
    expect(workflow.jobs.verify.if).toBe("${{ inputs.mode == 'publish' }}")
    expect(workflow.jobs.derive.if).toBe("${{ inputs.mode == 'release-pr' }}")
    expect(workflow.jobs['release-pr'].if).toBe(
      "${{ inputs.mode == 'release-pr' && inputs.dry-run == false }}",
    )
    expect(workflow.jobs.derive.permissions).toEqual({ contents: 'read' })
  })

  it('publishes the merged release commit, not whatever HEAD is', () => {
    const steps = workflow.jobs.verify.steps.map(step => step.name)
    expect(steps.indexOf('Check out the release commit')).toBe(
      steps.indexOf('Checkout source') + 1,
    )
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
    expect(workflow.jobs.publish.if).toBe(
      "${{ inputs.mode == 'publish' && inputs.dry-run == false }}",
    )
  })

  it('tags the commit verify built', () => {
    expect(workflow.jobs.verify.outputs.sha).toBe(
      '${{ steps.release-meta.outputs.sha }}',
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
