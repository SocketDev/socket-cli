/**
 * Socket cargo command — forwards cargo operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`, which collapses the standard parse-flags
 * / filter-flags / spawn-sfw / forward-exit pattern into a single declarative
 * spec. See `util/cli/define-handoff.mts`.
 */

import { defineHandoffCommand } from "../../util/cli/define-handoff.mts";

export const cmdCargo = defineHandoffCommand({
  name: "cargo",
  description: "Run cargo with Socket Firewall security",
  spawnMode: "dlx",
  examples: ["install ripgrep", "build", "add serde"],
  // cargo did not previously emit telemetry or support --dry-run.
  trackTelemetry: false,
  supportDryRun: false,
});
