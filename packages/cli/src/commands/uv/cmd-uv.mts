/**
 * Socket uv command — forwards uv operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { defineHandoffCommand } from "../../util/cli/define-handoff.mts";

export const cmdUv = defineHandoffCommand({
  name: "uv",
  description: "Run uv with Socket Firewall security",
  spawnMode: "dlx",
  examples: ["pip install flask", "pip sync", "run script.py"],
  trackTelemetry: false,
  supportDryRun: false,
});
