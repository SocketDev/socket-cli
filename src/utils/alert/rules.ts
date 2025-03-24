import { isObject } from '@socketsecurity/registry/lib/objects'

import { findSocketYmlSync, getConfigValue } from '../config'
import { isErrnoException } from '../errors'
import { getPublicToken, setupSdk } from '../sdk'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

type AlertUxLookup = ReturnType<typeof createAlertUXLookup>

type AlertUxLookupSettings = Parameters<AlertUxLookup>[0]

type AlertUxLookupResult = ReturnType<AlertUxLookup>

type NonNormalizedRule =
  | NonNullable<
      NonNullable<
        NonNullable<
          (SocketSdkResultType<'postSettings'> & {
            success: true
          })['data']['entries'][number]['settings'][string]
        >['issueRules']
      >
    >[string]
  | boolean

type NonNormalizedResolvedRule =
  | (NonNullable<
      NonNullable<
        (SocketSdkResultType<'postSettings'> & {
          success: true
        })['data']['defaults']['issueRules']
      >[string]
    > & { action: string })
  | boolean

type RuleActionUX = { block: boolean; display: boolean }

const ERROR_UX: RuleActionUX = {
  block: true,
  display: true
}

const IGNORE_UX: RuleActionUX = {
  block: false,
  display: false
}

const WARN_UX: RuleActionUX = {
  block: false,
  display: true
}

// Iterates over all entries with ordered issue rule for deferral.  Iterates over
// all issue rules and finds the first defined value that does not defer otherwise
// uses the defaultValue. Takes the value and converts into a UX workflow.
function resolveAlertRuleUX(
  orderedRulesCollection: Iterable<Iterable<NonNormalizedRule>>,
  defaultValue: NonNormalizedResolvedRule
): RuleActionUX {
  if (
    defaultValue === true ||
    defaultValue === null ||
    defaultValue === undefined
  ) {
    defaultValue = { action: 'error' }
  } else if (defaultValue === false) {
    defaultValue = { action: 'ignore' }
  }
  let block = false
  let display = false
  let needDefault = true
  iterate_entries: for (const rules of orderedRulesCollection) {
    for (const rule of rules) {
      if (ruleValueDoesNotDefer(rule)) {
        needDefault = false
        const narrowingFilter = uxForDefinedNonDeferValue(rule)
        block = block || narrowingFilter.block
        display = display || narrowingFilter.display
        continue iterate_entries
      }
    }
    const narrowingFilter = uxForDefinedNonDeferValue(defaultValue)
    block = block || narrowingFilter.block
    display = display || narrowingFilter.display
  }
  if (needDefault) {
    const narrowingFilter = uxForDefinedNonDeferValue(defaultValue)
    block = block || narrowingFilter.block
    display = display || narrowingFilter.display
  }
  return { block, display }
}

// Negative form because it is narrowing the type.
function ruleValueDoesNotDefer(
  rule: NonNormalizedRule
): rule is NonNormalizedResolvedRule {
  if (rule === undefined) {
    return false
  }
  if (isObject(rule)) {
    const { action } = rule
    if (action === undefined || action === 'defer') {
      return false
    }
  }
  return true
}

// Handles booleans for backwards compatibility.
function uxForDefinedNonDeferValue(
  ruleValue: NonNormalizedResolvedRule
): RuleActionUX {
  if (typeof ruleValue === 'boolean') {
    return ruleValue ? ERROR_UX : IGNORE_UX
  }
  const { action } = ruleValue
  if (action === 'warn') {
    return WARN_UX
  } else if (action === 'ignore') {
    return IGNORE_UX
  }
  return ERROR_UX
}

type SettingsType = (SocketSdkResultType<'postSettings'> & {
  success: true
})['data']

export function createAlertUXLookup(settings: SettingsType): (context: {
  package: { name: string; version: string }
  alert: { type: string }
}) => RuleActionUX {
  const cachedUX: Map<keyof typeof settings.defaults.issueRules, RuleActionUX> =
    new Map()
  return context => {
    const { type } = context.alert
    let ux = cachedUX.get(type)
    if (ux) {
      return ux
    }
    const orderedRulesCollection: NonNormalizedRule[][] = []
    for (const settingsEntry of settings.entries) {
      const orderedRules: NonNormalizedRule[] = []
      let target = settingsEntry.start
      while (target !== null) {
        const resolvedTarget = settingsEntry.settings[target]
        if (!resolvedTarget) {
          break
        }
        const issueRuleValue = resolvedTarget.issueRules?.[type]
        if (typeof issueRuleValue !== 'undefined') {
          orderedRules.push(issueRuleValue)
        }
        target = resolvedTarget.deferTo ?? null
      }
      orderedRulesCollection.push(orderedRules)
    }
    const defaultValue = settings.defaults.issueRules[type] as
      | { action: 'error' | 'ignore' | 'warn' }
      | boolean
      | undefined
    let resolvedDefaultValue: NonNormalizedResolvedRule = {
      action: 'error'
    }
    if (defaultValue === false) {
      resolvedDefaultValue = { action: 'ignore' }
    } else if (defaultValue && defaultValue !== true) {
      resolvedDefaultValue = { action: defaultValue.action ?? 'error' }
    }
    ux = resolveAlertRuleUX(orderedRulesCollection, resolvedDefaultValue)
    cachedUX.set(type, ux)
    return ux
  }
}

let _uxLookup: AlertUxLookup | undefined
export async function uxLookup(
  settings: AlertUxLookupSettings
): Promise<AlertUxLookupResult> {
  if (_uxLookup === undefined) {
    const { orgs, settings } = await (async () => {
      try {
        const sockSdk = await setupSdk(getPublicToken())
        const orgResult = await sockSdk.getOrganizations()
        if (!orgResult.success) {
          if (orgResult.status === 429) {
            throw new Error(`API token quota exceeded: ${orgResult.error}`)
          }
          throw new Error(
            `Failed to fetch Socket organization info: ${orgResult.error}`
          )
        }
        const { organizations } = orgResult.data
        const orgs: Array<Exclude<(typeof organizations)[string], undefined>> =
          []
        for (const org of Object.values(organizations)) {
          if (org) {
            orgs.push(org)
          }
        }
        const settingsResult = await sockSdk.postSettings(
          orgs.map(org => ({ organization: org.id }))
        )
        if (!settingsResult.success) {
          throw new Error(
            `Failed to fetch API key settings: ${settingsResult.error}`
          )
        }
        return {
          orgs,
          settings: settingsResult.data
        }
      } catch (e) {
        const cause = isObject(e) && 'cause' in e ? e['cause'] : undefined
        if (
          isErrnoException(cause) &&
          (cause.code === 'ENOTFOUND' || cause.code === 'ECONNREFUSED')
        ) {
          throw new Error(
            'Unable to connect to socket.dev, ensure internet connectivity before retrying',
            {
              cause: e
            }
          )
        }
        throw e
      }
    })()
    // Remove any organizations not being enforced.
    const enforcedOrgs = getConfigValue('enforcedOrgs') ?? []
    for (const { 0: i, 1: org } of orgs.entries()) {
      if (!enforcedOrgs.includes(org.id)) {
        settings.entries.splice(i, 1)
      }
    }
    const socketYml = findSocketYmlSync()
    if (socketYml) {
      settings.entries.push({
        start: socketYml.path,
        settings: {
          [socketYml.path]: {
            deferTo: null,
            // TODO: TypeScript complains about the type not matching. We should
            // figure out why are providing
            // issueRules: { [issueName: string]: boolean }
            // but expecting
            // issueRules: { [issueName: string]: { action: 'defer' | 'error' | 'ignore' | 'monitor' | 'warn' } }
            issueRules: socketYml.parsed.issueRules as unknown as {
              [key: string]: {
                action: 'defer' | 'error' | 'ignore' | 'monitor' | 'warn'
              }
            }
          }
        }
      })
    }
    _uxLookup = createAlertUXLookup(settings)
  }
  return _uxLookup(settings)
}
