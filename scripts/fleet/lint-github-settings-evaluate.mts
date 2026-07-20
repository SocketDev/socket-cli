/**
 * @file The settings→findings decision tree for `lint-github-settings.mts`'s
 *   audit. Split out to keep each file in the split under the 500-line soft
 *   cap — `evaluate` alone is the bulk of the original file's line count.
 */

import type {
  BranchProtectionPayload,
  Finding,
  RepoApiPayload,
  Severity,
} from './lint-github-settings-types.mts'
import { REQUIRED_APP_SLUGS } from './lint-github-settings-types.mts'

/**
 * Custom-property opt-out knobs that downgrade specific rules from 'error' to
 * 'warn'. Reading the property values is one API call per audit (see
 * `loadCustomProperties`).
 *
 * Why warn-not-skip: a maintainer marking a repo
 * `temporarily-doesnt-touch-customers: true` should still see a reminder of
 * what's deferred — silencing the finding entirely would mean the eventual lift
 * forgets the reminder existed. Warn = visible-but-not-CI-blocking.
 */
export function severityOverride(
  ruleKey: string,
  props: Record<string, string | null>,
): Severity {
  const disableGhAS = props['disable-github-actions-security'] === 'true'
  const doesntTouchCustomers = props['doesnt-touch-customers'] === 'true'
  const tempDoesntTouchCustomers =
    props['temporarily-doesnt-touch-customers'] === 'true'

  // The shared socket-registry setup/install IS the security gate;
  // per-repo branch protection is belt-and-suspenders. When the
  // maintainer has explicitly opted out of redundant GH Actions
  // security, downgrade branch-protection findings to warn.
  if (
    disableGhAS &&
    (ruleKey === 'branch-protection-allow-deletions' ||
      ruleKey === 'branch-protection-allow-force-pushes' ||
      ruleKey === 'branch-protection-dismiss-stale-reviews' ||
      ruleKey === 'branch-protection-enforce-admins' ||
      ruleKey === 'branch-protection-exists' ||
      ruleKey === 'branch-protection-required-pr-reviews' ||
      ruleKey === 'branch-protection-required-signatures')
  ) {
    return 'warn'
  }

  // Customer-facing rules: only enforce on repos that DO touch
  // customers. Private/unpublished or in-remediation repos get
  // warnings instead of errors so the maintainer sees the reminder
  // without CI red.
  const customerFacingRules = new Set([
    'has_discussions must be false',
    'has_projects must be false',
    'has_wiki must be false',
    'pull_request_creation_policy must be collaborators_only',
  ])
  if (
    (doesntTouchCustomers || tempDoesntTouchCustomers) &&
    customerFacingRules.has(ruleKey)
  ) {
    return 'warn'
  }

  return 'error'
}

/**
 * Canonical fleet config. Each rule names the API field, expected value, and
 * the fix URL. `fixPatch` is the body to send to PATCH /repos/{owner}/{repo}
 * when --fix is given (undefined = manual fix required, no API endpoint yet).
 */
export function evaluate(
  repo: string,
  apiRepo: RepoApiPayload,
  apiProtection: BranchProtectionPayload | undefined,
  installedApps: Set<string>,
  localShadows: ReadonlyArray<{ basename: string; localPath: string }>,
  customProps: Record<string, string | null>,
): Finding[] {
  const findings: Finding[] = []
  const settingsUrl = `https://github.com/${repo}/settings`
  const branchesUrl = `https://github.com/${repo}/settings/branches`

  const check = (
    rule: string,
    current: unknown,
    expected: unknown,
    fixUrl: string,
    fixPatch: Record<string, unknown> | undefined,
  ): void => {
    if (current === expected) {
      return
    }
    findings.push({
      rule,
      severity: severityOverride(rule, customProps),
      current,
      expected,
      fixUrl,
      fixable: fixPatch !== undefined,
      ...(fixPatch !== undefined
        ? { fixPatch, fixRequires: 'repo:admin' }
        : {}),
    })
  }

  check(
    'default_branch must be main',
    apiRepo.default_branch,
    'main',
    branchesUrl,
    // No PATCH for default_branch via /repos/{owner}/{repo} — need to
    // rename the branch first via /repos/{owner}/{repo}/rename-branch
    // and then set it. Manual.
    undefined,
  )
  check(
    'has_wiki must be false',
    apiRepo.has_wiki,
    false,
    `${settingsUrl}#features`,
    { has_wiki: false },
  )
  check(
    'has_discussions must be false',
    apiRepo.has_discussions,
    false,
    `${settingsUrl}#features`,
    { has_discussions: false },
  )
  check(
    'has_projects must be false',
    apiRepo.has_projects,
    false,
    `${settingsUrl}#features`,
    { has_projects: false },
  )
  // Note: `allow_forking` is intentionally NOT checked. The actual
  // "no outside-contributor PRs" gate is `pull_request_creation_
  // policy: collaborators_only` (checked below). Letting people fork
  // for read access / personal-use is the open-source default and
  // doesn't bypass PR review.
  check(
    'allow_squash_merge must be true',
    apiRepo.allow_squash_merge,
    true,
    `${settingsUrl}#pull-requests`,
    { allow_squash_merge: true },
  )
  check(
    'allow_merge_commit must be false',
    apiRepo.allow_merge_commit,
    false,
    `${settingsUrl}#pull-requests`,
    { allow_merge_commit: false },
  )
  check(
    'allow_rebase_merge must be false',
    apiRepo.allow_rebase_merge,
    false,
    `${settingsUrl}#pull-requests`,
    { allow_rebase_merge: false },
  )
  check(
    'allow_auto_merge must be true',
    apiRepo.allow_auto_merge,
    true,
    `${settingsUrl}#pull-requests`,
    { allow_auto_merge: true },
  )
  check(
    'allow_update_branch must be true',
    apiRepo.allow_update_branch,
    true,
    `${settingsUrl}#pull-requests`,
    { allow_update_branch: true },
  )
  check(
    'delete_branch_on_merge must be true',
    apiRepo.delete_branch_on_merge,
    true,
    `${settingsUrl}#pull-requests`,
    { delete_branch_on_merge: true },
  )
  check(
    'pull_request_creation_policy must be collaborators_only',
    apiRepo.pull_request_creation_policy,
    'collaborators_only',
    `${settingsUrl}#pull-requests`,
    { pull_request_creation_policy: 'collaborators_only' },
  )
  // DCO: web-based commits must be signed off (the fleet's Developer Certificate
  // of Origin gate). Auto-fixable via PATCH /repos/{owner}/{repo}.
  check(
    'web_commit_signoff_required must be true',
    apiRepo.web_commit_signoff_required,
    true,
    `${settingsUrl}#commits`,
    { web_commit_signoff_required: true },
  )

  // Branch protection on main — signed commits.
  if (!apiProtection) {
    findings.push({
      rule: 'main branch protection must exist',
      severity: severityOverride('branch-protection-exists', customProps),
      current: undefined,
      expected: '{ required_signatures: { enabled: true } }',
      fixUrl: branchesUrl,
      fixable: false,
    })
  } else {
    // Required signatures.
    if (apiProtection.required_signatures?.enabled !== true) {
      findings.push({
        rule: 'main branch protection: required_signatures must be enabled',
        severity: severityOverride(
          'branch-protection-required-signatures',
          customProps,
        ),
        current: apiProtection.required_signatures?.enabled ?? false,
        expected: true,
        fixUrl: branchesUrl,
        // PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures
        // is the endpoint; this script's --fix doesn't auto-apply it
        // because rewriting branch protection rules can clobber custom
        // status-check requirements set by the maintainer. Manual.
        fixable: false,
      })
    }
    // Required PR reviews. Direct pushes to main are forbidden under
    // the fleet's standard policy. At least 1 approving review,
    // dismiss stale reviews on new pushes. Code-owner enforcement
    // is opt-in per repo (some repos don't have a CODEOWNERS file).
    const prReviews = apiProtection.required_pull_request_reviews
    if (!prReviews) {
      findings.push({
        rule: 'main branch protection: required_pull_request_reviews must be enabled',
        severity: severityOverride(
          'branch-protection-required-pr-reviews',
          customProps,
        ),
        current: undefined,
        expected:
          '{ required_approving_review_count: 1, dismiss_stale_reviews: true }',
        fixUrl: branchesUrl,
        fixable: false,
      })
    } else {
      if ((prReviews.required_approving_review_count ?? 0) < 1) {
        findings.push({
          rule: 'main branch protection: required_approving_review_count must be ≥ 1',
          severity: severityOverride(
            'branch-protection-required-pr-reviews',
            customProps,
          ),
          current: prReviews.required_approving_review_count ?? 0,
          expected: '≥ 1',
          fixUrl: branchesUrl,
          fixable: false,
        })
      }
      if (prReviews.dismiss_stale_reviews !== true) {
        findings.push({
          rule: 'main branch protection: dismiss_stale_reviews must be enabled',
          severity: severityOverride(
            'branch-protection-dismiss-stale-reviews',
            customProps,
          ),
          current: prReviews.dismiss_stale_reviews ?? false,
          expected: true,
          fixUrl: branchesUrl,
          fixable: false,
        })
      }
    }
    // Force pushes — must be disabled. A force push to main is the
    // recovery-from-bad-state pattern that also enables stolen-token
    // attacks (rewrite history, push back).
    if (apiProtection.allow_force_pushes?.enabled === true) {
      findings.push({
        rule: 'main branch protection: allow_force_pushes must be disabled',
        severity: severityOverride(
          'branch-protection-allow-force-pushes',
          customProps,
        ),
        current: true,
        expected: false,
        fixUrl: branchesUrl,
        fixable: false,
      })
    }
    // Branch deletion — must be disabled. The default branch shouldn't
    // be deletable via the API (separate concern from regular
    // branch cleanup).
    if (apiProtection.allow_deletions?.enabled === true) {
      findings.push({
        rule: 'main branch protection: allow_deletions must be disabled',
        severity: severityOverride(
          'branch-protection-allow-deletions',
          customProps,
        ),
        current: true,
        expected: false,
        fixUrl: branchesUrl,
        fixable: false,
      })
    }
    // Enforce admins — must be enabled. Without this, repo admins
    // can bypass every other branch-protection rule. The whole
    // point of branch protection is to apply uniformly; admin
    // bypass undermines it.
    if (apiProtection.enforce_admins?.enabled !== true) {
      findings.push({
        rule: 'main branch protection: enforce_admins must be enabled',
        severity: severityOverride(
          'branch-protection-enforce-admins',
          customProps,
        ),
        current: apiProtection.enforce_admins?.enabled ?? false,
        expected: true,
        fixUrl: branchesUrl,
        fixable: false,
      })
    }
  }

  // Required apps. Each missing app gets one finding with the install URL.
  for (let i = 0, { length } = REQUIRED_APP_SLUGS; i < length; i += 1) {
    const slug = REQUIRED_APP_SLUGS[i]!
    if (!installedApps.has(slug)) {
      findings.push({
        rule: `GitHub App must be installed: ${slug}`,
        // App findings stay 'error' regardless of custom properties —
        // app installation is universal. (Could be made overridable
        // per-property if a use case emerges.)
        severity: 'error',
        current:
          'not detected on recent check-suites or declared in .github/required-apps.yml',
        expected: 'installed + declared',
        fixUrl: `https://github.com/apps/${slug}`,
        fixable: false,
      })
    }
  }

  // Local shadows of shared workflows. A finding wants EITHER the local file
  // gone in favor of `uses:`-ing the shared workflow, OR an explicit opt-out
  // header `# socket-bypass: workflow-shadow -- <reason>` on the local file
  // documenting why it's intentional.
  for (let i = 0, { length } = localShadows; i < length; i += 1) {
    const shadow = localShadows[i]!
    findings.push({
      rule: `Local workflow shadows a shared one: ${shadow.basename}`,
      severity: 'error',
      current: shadow.localPath,
      expected:
        `uses: SocketDev/socket-registry/.github/workflows/${shadow.basename}@<sha> ` +
        `OR add a header comment '# socket-bypass: workflow-shadow -- <reason>' ` +
        `to document why this local workflow is intentional`,
      fixUrl: `https://github.com/${repo}/blob/${apiRepo.default_branch ?? 'main'}/${shadow.localPath}`,
      fixable: false,
    })
  }

  return findings
}
