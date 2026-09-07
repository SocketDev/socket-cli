import { sendApiRequest } from '../../util/socket/api.mjs'

import type { CResult } from '../../types.mts'

/**
 * Finalize a tier1 reachability scan. - Associates the tier1 reachability scan
 * metadata with the full scan, or with `null` when a standalone reachability
 * flow has no full scan to bind to. - Transitions the tier1 reachability scan
 * to its DONE terminal state.
 *
 * Callers pass `undefined` for the standalone flow; the wire value is
 * normalized to an explicit JSON `null` here because omitting the key is not
 * the same request.
 */
export async function finalizeTier1Scan(
  tier1ReachabilityScanId: string,
  scanId?: string | undefined,
): Promise<CResult<unknown>> {
  // we do not use the SDK here because the tier1-reachability-scan/finalize is a hidden
  // endpoint that is not part of the OpenAPI specification.
  return await sendApiRequest('tier1-reachability-scan/finalize', 'POST', {
    body: {
      tier1_reachability_scan_id: tier1ReachabilityScanId,
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- wire format: the endpoint distinguishes an explicit null from a missing key.
      report_run_id: scanId ?? null,
    },
  })
}
