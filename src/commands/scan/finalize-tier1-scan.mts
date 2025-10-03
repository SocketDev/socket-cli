/** @fileoverview Tier-1 scan finalization utility for Socket CLI. Finalizes tier-1 security scans with reachability analysis results. Submits scan finalization requests to Socket API. */

import { sendApiRequest } from '../../utils/api.mts'

import type { CResult } from '../../types.mts'

export type FinalizeTier1ScanOptions = {
  tier1_reachability_scan_id: string
  report_run_id: string
}

/**
 * Finalize a tier1 reachability scan.
 *  - Associates the tier1 reachability scan metadata with the full scan.
 *  - Sets the tier1 reachability scan to "finalized" state.
 */
export async function finalizeTier1Scan(
  tier1ReachabilityScanId: string,
  scanId: string,
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
