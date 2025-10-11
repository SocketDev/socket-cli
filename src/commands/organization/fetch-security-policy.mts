import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type FetchSecurityPolicyOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

// Type expected by output modules
export interface SecurityPolicyResult {
  rules: Array<{
    category: string
    enabled: boolean
    severity: 'critical' | 'high' | 'medium' | 'low'
  }>
  blockOnViolation: boolean
}

export async function fetchSecurityPolicy(
  orgSlug: string,
  options?: FetchSecurityPolicyOptions | undefined,
): Promise<CResult<SecurityPolicyResult>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchSecurityPolicyOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const apiResult = await handleApiCall(sockSdk.getOrgSecurityPolicy(orgSlug), {
    description: 'organization security policy',
  })

  if (!apiResult.ok) {
    return apiResult
  }

  // Transform API response to expected format
  const rules: SecurityPolicyResult['rules'] = []
  const policyRules = apiResult.data.securityPolicyRules

  if (policyRules) {
    // Convert each rule from the API format to our expected format
    for (const [category, config] of Object.entries(policyRules)) {
      if (config && typeof config === 'object' && 'action' in config) {
        const action = config.action as string
        rules.push({
          category,
          enabled: action !== 'ignore',
          severity: action === 'error' ? 'critical' :
                   action === 'warn' ? 'high' :
                   action === 'monitor' ? 'medium' : 'low',
        })
      }
    }
  }

  // Determine if violations should block based on default policy
  // 'high' severity likely means blocking violations
  const blockOnViolation = apiResult.data.securityPolicyDefault === 'high'

  const transformed: SecurityPolicyResult = {
    rules,
    blockOnViolation,
  }

  return {
    ok: true,
    data: transformed,
  }
}