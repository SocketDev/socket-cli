//#region UX Constants
/**
 * @typedef {{block: boolean, display: boolean}} RuleActionUX
 */
const IGNORE_UX = {
  block: false,
  display: false
}
const WARN_UX = {
  block: false,
  display: true
}
const ERROR_UX = {
  block: true,
  display: true
}
//#endregion
//#region utils
/**
 * @typedef { NonNullable<NonNullable<NonNullable<(Awaited<ReturnType<import('@socketsecurity/sdk').SocketSdk['postSettings']>> & {success: true})['data']['entries'][number]['settings'][string]>['issueRules']>>[string] | boolean } NonNormalizedIssueRule
 */
/**
 * @typedef { (NonNullable<NonNullable<(Awaited<ReturnType<import('@socketsecurity/sdk').SocketSdk['postSettings']>> & {success: true})['data']['defaults']['issueRules']>[string]> & { action: string }) | boolean } NonNormalizedResolvedIssueRule
 */
/**
 * Iterates over all entries with ordered issue rule for deferal
 * Iterates over all issue rules and finds the first defined value that does not defer otherwise uses the defaultValue
 * Takes the value and converts into a UX workflow
 *
 * @param {Iterable<Iterable<NonNormalizedIssueRule>>} entriesOrderedIssueRules
 * @param {NonNormalizedResolvedIssueRule} defaultValue
 * @returns {RuleActionUX}
 */
function resolveIssueRuleUX (entriesOrderedIssueRules, defaultValue) {
  if (defaultValue === true || defaultValue == null) {
    defaultValue = {
      action: 'error'
    }
  } else if (defaultValue === false) {
    defaultValue = {
      action: 'ignore'
    }
  }
  let block = false
  let display = false
  let needDefault = true
  iterate_entries:
  for (const issueRuleArr of entriesOrderedIssueRules) {
    for (const rule of issueRuleArr) {
      if (issueRuleValueDoesNotDefer(rule)) {
        // there was a rule, even if a defer, don't narrow to the default
        needDefault = false
        const narrowingFilter = uxForDefinedNonDeferValue(rule)
        block = block || narrowingFilter.block
        display = display || narrowingFilter.display
        continue iterate_entries
      }
    }
    // all rules defer, narrow
    const narrowingFilter = uxForDefinedNonDeferValue(defaultValue)
    block = block || narrowingFilter.block
    display = display || narrowingFilter.display
  }
  if (needDefault) {
    // no config set a
    const narrowingFilter = uxForDefinedNonDeferValue(defaultValue)
    block = block || narrowingFilter.block
    display = display || narrowingFilter.display
  }
  return {
    block,
    display
  }
}

/**
 * Negative form because it is narrowing the type
 *
 * @type {(issueRuleValue: NonNormalizedIssueRule) => issueRuleValue is NonNormalizedResolvedIssueRule}
 */
function issueRuleValueDoesNotDefer (issueRule) {
  if (issueRule === undefined) {
    return false
  } else if (typeof issueRule === 'object' && issueRule) {
    const { action } = issueRule
    if (action === undefined || action === 'defer') {
      return false
    }
  }
  return true
}

/**
 * Handles booleans for backwards compatibility
 *
 * @param {NonNormalizedResolvedIssueRule} issueRuleValue
 * @returns {RuleActionUX}
 */
function uxForDefinedNonDeferValue (issueRuleValue) {
  if (typeof issueRuleValue === 'boolean') {
    return issueRuleValue ? ERROR_UX : IGNORE_UX
  }
  const { action } = issueRuleValue
  if (action === 'warn') {
    return WARN_UX
  } else if (action === 'ignore') {
    return IGNORE_UX
  }
  return ERROR_UX
}
//#endregion
//#region exports
module.exports = {
  /**
   *
   * @param {(Awaited<ReturnType<import('@socketsecurity/sdk').SocketSdk['postSettings']>> & {success: true})['data']} settings
   * @returns {(context: {package: {name: string, version: string}, issue: {type: string}}) => RuleActionUX}
   */
  createIssueUXLookup (settings) {
    /**
     * @type {Map<keyof (typeof settings.defaults.issueRules), RuleActionUX>}
     */
    const cachedUX = new Map()
    return (context) => {
      const key = context.issue.type
      /**
       * @type {RuleActionUX | undefined}
       */
      let ux = cachedUX.get(key)
      if (ux) {
        return ux
      }
      /**
       * @type {Array<Array<NonNormalizedIssueRule>>}
       */
      const entriesOrderedIssueRules = []
      for (const settingsEntry of settings.entries) {
        /**
         * @type {Array<NonNormalizedIssueRule>}
         */
        const orderedIssueRules = []
        let target = settingsEntry.start
        while (target !== null) {
          const resolvedTarget = settingsEntry.settings[target]
          if (!resolvedTarget) {
            break
          }
          const issueRuleValue = resolvedTarget.issueRules?.[key]
          if (typeof issueRuleValue !== 'undefined') {
            orderedIssueRules.push(issueRuleValue)
          }
          target = resolvedTarget.deferTo ?? null
        }
        entriesOrderedIssueRules.push(orderedIssueRules)
      }
      const defaultValue = settings.defaults.issueRules[key]
      /**
       * @type {NonNormalizedResolvedIssueRule}
       */
      let resolvedDefaultValue = {
        action: 'error'
      }
      // @ts-ignore backcompat, cover with tests
      if (defaultValue === false) {
        resolvedDefaultValue = {
          action: 'ignore'
        }
      // @ts-ignore backcompat, cover with tests
      } else if (defaultValue && defaultValue !== true) {
        resolvedDefaultValue = {
          action: defaultValue.action ?? 'error'
        }
      }
      ux = resolveIssueRuleUX(entriesOrderedIssueRules, resolvedDefaultValue)
      cachedUX.set(key, ux)
      return ux
    }
  }
}
//#endregion
