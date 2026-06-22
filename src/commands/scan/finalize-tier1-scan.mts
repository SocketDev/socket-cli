import { sendApiRequest } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'

export type FinalizeTier1ScanOptions = {
  tier1_reachability_scan_id: string
  report_run_id: string | null
}

/**
 * Finalize a full application reachability scan (formerly known as "tier 1";
 * the wire endpoint and request fields below retain the legacy tier1 name as
 * a backend contract).
 *  - Associates the reachability scan metadata with the full scan
 *    (or with `null` when called from a standalone reachability flow that
 *    has no full scan to bind to).
 *  - Transitions the reachability scan to its DONE terminal state.
 */
export async function finalizeTier1Scan(
  tier1ReachabilityScanId: string,
  scanId: string | null,
): Promise<CResult<unknown>> {
  // we do not use the SDK here because the tier1-reachability-scan/finalize is a hidden
  // endpoint that is not part of the OpenAPI specification.
  return await sendApiRequest('tier1-reachability-scan/finalize', {
    method: 'POST',
    body: {
      tier1_reachability_scan_id: tier1ReachabilityScanId,
      report_run_id: scanId,
    },
  })
}
