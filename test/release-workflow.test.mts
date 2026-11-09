import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ReleaseStep {
  if?: string
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
    prepare: ReleaseJob
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
const githubReleaseWorkflow = parse(
  readFileSync(
    new URL('../.github/workflows/release-github.yml', import.meta.url),
    'utf8',
  ),
) as { jobs: { release: { steps: ReleaseStep[] } } }

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
      'prepare',
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
    expect(workflow.jobs.prepare.if).toBe("${{ inputs.mode == 'release-pr' }}")
    expect(workflow.jobs['release-pr'].if).toBe(
      "${{ inputs.mode == 'release-pr' && inputs.dry-run == false }}",
    )
    expect(workflow.jobs.prepare.permissions).toEqual({ contents: 'read' })
  })

  it('publishes the merged release commit, not whatever HEAD is', () => {
    const steps = workflow.jobs.verify.steps.map(step => step.name)
    expect(steps.indexOf('Check out the release commit')).toBe(
      steps.indexOf('Checkout source') + 1,
    )
  })

  it('verifies the selected release commit before npm staging', () => {
    const steps = workflow.jobs.verify.steps
    const checkoutIndex = steps.findIndex(
      step => step.name === 'Check out the release commit',
    )
    const verifyIndex = steps.findIndex(
      step => step.name === 'Verify the release commit before staging',
    )
    const verify = steps[verifyIndex]
    expect(verify?.if).toBe('${{ inputs.dry-run == false }}')
    expect(verify?.run).toContain('.commit.verification.verified')
    expect(verifyIndex).toBe(checkoutIndex + 1)
  })

  it('prints npm stage IDs and reserves a release tag only once', () => {
    const stage = workflow.jobs.publish.steps.find(
      step => step.name === 'Stage release packages',
    )
    expect(stage?.run).toContain('--json')
    expect(stage?.run).toContain('stageId')
    expect(stage?.run).toContain('output.search(/^(?:\\{|\\[)/mu)')
    expect(stage?.run).toContain('pnpm run approve:npm <stage-id>')
    const tag = workflow.jobs.publish.steps.find(
      step => step.name === 'Reserve release tag once',
    )
    expect(tag?.run).toContain('already reserved')
    expect(tag?.run).toContain('Recover its stage ID')
    expect(
      workflow.jobs.publish.steps.some(step =>
        step.name?.includes('GitHub release'),
      ),
    ).toBe(false)
  })

  it('parses npm stage JSON after pnpm progress output', () => {
    const stage = workflow.jobs.publish.steps.find(
      step => step.name === 'Stage release packages',
    )
    const parser = stage?.run
      ?.split("<<'NODE'\n")[1]
      ?.split('\nNODE')[0]
    expect(parser).toBeDefined()

    const directory = mkdtempSync(path.join(tmpdir(), 'npm-stage-output-'))
    const outputPath = path.join(directory, 'output.json')
    const summaryPath = path.join(directory, 'summary.md')
    const tarballPath = path.join(directory, 'socket-2.1.0-rc.0.tgz')
    const stageId = '12345678-1234-4123-8123-123456789abc'
    try {
      writeFileSync(
        outputPath,
        [
          'GET https://example.invalid/idtoken 200 193ms',
          'Staging socket@2.1.0-rc.0',
          JSON.stringify({
            socket: {
              name: 'socket',
              version: '2.1.0-rc.0',
              stageId,
            },
          }),
          '',
        ].join('\n'),
      )
      execFileSync(
        process.execPath,
        ['--input-type=module', '-', outputPath, summaryPath, tarballPath],
        { input: parser },
      )
      expect(readFileSync(summaryPath, 'utf8')).toContain(stageId)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('selects the expected stage package count from the cross-job version output', () => {
    const stage = workflow.jobs.publish.steps.find(
      step => step.name === 'Stage release packages',
    )
    expect(stage?.env?.VERSION).toBe('${{ needs.verify.outputs.version }}')
    expect(stage?.run).toContain(
      'if [[ "$VERSION" == *-* ]]; then EXPECTED=1; fi',
    )
    expect(stage?.run).not.toContain('NPM_PRERELEASE_RELEASE')
  })

  it('checks signed default-branch tags and npm availability before finalization', () => {
    const steps = githubReleaseWorkflow.jobs.release.steps
    const checkout = steps.find(
      step => step.name === 'Check out default branch and reserved tag',
    )
    const check = steps.find(
      step =>
        step.name === 'Validate release policy and wait for npm publication',
    )
    const finalize = steps.find(
      step => step.name === 'Create or retry GitHub release finalization',
    )
    expect(checkout?.run).toContain('commit.verification.verified')
    expect(checkout?.run).toContain('git merge-base --is-ancestor')
    expect(check?.run).toContain('availability.mts')
    const checkIndex = steps.findIndex(step => step === check)
    const finalizeIndex = steps.findIndex(step => step === finalize)
    expect(checkIndex).toBeGreaterThanOrEqual(0)
    expect(finalizeIndex).toBeGreaterThan(checkIndex)
    expect(finalize?.run).toContain('make_latest=false')
    expect(finalize?.run).toContain('gh release view "${TAG}" --json databaseId')
    expect(finalize?.run).not.toContain('releases/tags/${TAG}')
  })

  it('publishes only socket for the configured prerelease policy', () => {
    const verifySteps = workflow.jobs.verify.steps
    const versionGuard = verifySteps.find(
      step => step.name === 'Validate release policy and choose npm dist-tag',
    )
    const versionGuardIndex = verifySteps.findIndex(
      step => step.name === 'Validate release policy and choose npm dist-tag',
    )
    const buildIndex = verifySteps.findIndex(
      step => step.name === 'Build Maven manifest extension jar',
    )
    expect(versionGuard).toBeDefined()
    expect(versionGuard?.if).toBe('${{ inputs.dry-run == false }}')
    expect(versionGuard?.run).toContain('validate-npm-policy.mts')
    expect(versionGuardIndex).toBeGreaterThanOrEqual(0)
    expect(versionGuardIndex).toBeLessThan(buildIndex)

    const prepareStep = workflow.jobs.prepare.steps.find(
      step => step.name === 'Prepare version and changelog',
    )
    expect(prepareStep?.env?.SOCKET_CLI_RELEASE_MAJOR).toBe(
      '${{ inputs.release-major }}',
    )
    expect(
      workflow.jobs.verify.steps.find(
        step => step.name === 'Build and pack @socketsecurity/cli (legacy)',
      )?.if,
    ).toBe("${{ env.NPM_PRERELEASE_RELEASE != 'true' }}")
    expect(
      workflow.jobs.verify.steps.find(
        step => step.name === 'Build and pack @socketsecurity/cli-with-sentry',
      )?.if,
    ).toBe("${{ env.NPM_PRERELEASE_RELEASE != 'true' }}")

    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { publishConfig?: { tag?: string }; version?: string }
    expect(manifest.version).toMatch(/^2\.1\.0-rc\.\d+$/u)
    expect(manifest.publishConfig?.tag).toBe('rc-2.1.0')
    expect(workflow.on.workflow_dispatch.inputs['release-major']?.default).toBe(
      '1',
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
