// CLI orchestration for `node installers.mts` direct invocation — runs every
// tool installer, then prints a summary table. Lives in its own file because
// installers.mts is at the 500-line soft cap; this is the "drive every
// installer + report" phase, not a tool installer itself.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { setupHeadroom } from './headroom.mts'
import {
  findApiToken,
  setupActionlint,
  setupAgentShield,
  setupCdxgen,
  setupJanus,
  setupOpengrep,
  setupSfw,
  setupSkillSpector,
  setupSynp,
  setupTrivy,
  setupTrufflehog,
  setupUv,
  setupZizmor,
} from './installers.mts'
import { HEADROOM } from './tool-config.mts'

const logger = getDefaultLogger()

export async function runSetupAll(): Promise<void> {
  logger.log('Setting up Socket security tools…')
  logger.log('')

  const apiToken = findApiToken()

  const agentshieldOk = await setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')
  const sfwOk = await setupSfw(apiToken)
  logger.log('')
  // socket-basics SAST + secrets stack + janus (shared wheelhouse) +
  // npm-only tools (cdxgen, synp) — non-fatal if any individual tool
  // fails (the basics workflow degrades cleanly when a scanner is
  // absent; janus is opt-in and mac-only; cdxgen + synp are consumed
  // by socket-cli scan/lockfile codepaths). Install in parallel since
  // they don't share state.
  const [
    actionlintOk,
    cdxgenOk,
    headroomOk,
    janusOk,
    opengrepOk,
    skillspectorOk,
    synpOk,
    trivyOk,
    trufflehogOk,
    uvOk,
  ] = await Promise.all([
    setupActionlint(),
    setupCdxgen(),
    setupHeadroom(HEADROOM.version!),
    setupJanus(),
    setupOpengrep(),
    setupSkillSpector(),
    setupSynp(),
    setupTrivy(),
    setupTrufflehog(),
    setupUv(),
  ])
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`actionlint:   ${actionlintOk ? 'ready' : 'FAILED'}`)
  logger.log(`AgentShield:  ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`cdxgen:       ${cdxgenOk ? 'ready' : 'FAILED'}`)
  // headroom-ai is opt-in like SkillSpector — installs from a locked uv project
  // into the _dlx store (needs uv on PATH). OPTIONAL, not part of allOk.
  logger.log(`headroom-ai:  ${headroomOk ? 'ready' : 'OPTIONAL (uv required)'}`)
  logger.log(`janus:        ${janusOk ? 'ready' : 'FAILED'}`)
  logger.log(`OpenGrep:     ${opengrepOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:          ${sfwOk ? 'ready' : 'FAILED'}`)
  // SkillSpector is opt-in — installs from a locked uv project (needs uv on
  // PATH). Don't fail the umbrella run if it isn't installed; surface it as
  // "OPTIONAL" so the operator knows it's an extra they can enable.
  logger.log(
    `SkillSpector: ${skillspectorOk ? 'ready' : 'OPTIONAL (uv required)'}`,
  )
  logger.log(`synp:         ${synpOk ? 'ready' : 'FAILED'}`)
  logger.log(`Trivy:        ${trivyOk ? 'ready' : 'FAILED'}`)
  logger.log(`TruffleHog:   ${trufflehogOk ? 'ready' : 'FAILED'}`)
  logger.log(`uv:           ${uvOk ? 'ready' : 'FAILED'}`)
  logger.log(`Zizmor:       ${zizmorOk ? 'ready' : 'FAILED'}`)

  const allOk =
    actionlintOk &&
    agentshieldOk &&
    cdxgenOk &&
    janusOk &&
    opengrepOk &&
    sfwOk &&
    synpOk &&
    trivyOk &&
    trufflehogOk &&
    uvOk &&
    zizmorOk
  if (allOk) {
    logger.log('')
    logger.log('All security tools ready.')
  } else {
    logger.error('')
    logger.warn('Some tools not available. See above.')
  }
}
