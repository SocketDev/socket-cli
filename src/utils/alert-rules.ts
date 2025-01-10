import { isObject } from '@socketsecurity/registry/lib/objects'

import type { SocketSdkResultType } from '@socketsecurity/sdk'

//#region UX Constants
type RuleActionUX = { block: boolean; display: boolean }

const IGNORE_UX: RuleActionUX = {
  block: false,
  display: false
}

const WARN_UX: RuleActionUX = {
  block: false,
  display: true
}

const ERROR_UX: RuleActionUX = {
  block: true,
  display: true
}
//#endregion
//#region utils
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

/**
 * Iterates over all entries with ordered issue rule for deferral.  Iterates over
 * all issue rules and finds the first defined value that does not defer otherwise
 * uses the defaultValue. Takes the value and converts into a UX workflow.
 */
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

/**
 * Negative form because it is narrowing the type.
 */
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

/**
 * Handles booleans for backwards compatibility.
 */
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
//#endregion

//#region exports
type SettingsType = (SocketSdkResultType<'postSettings'> & {
  success: true
})['data']

export function createAlertUXLookup(
  settings: SettingsType
): (context: {
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
    const orderedRulesCollection: Array<Array<NonNormalizedRule>> = []
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
//#endregion
