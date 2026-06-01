/**
 * Socket npx command — forwards npx operations to Socket Firewall (sfw).
 *
 * Defined via `defineHandoffCommand`. See util/cli/define-handoff.mts.
 */

import { NPX } from "@socketsecurity/lib-stable/constants/agents";

import { defineHandoffCommand } from "../../util/cli/define-handoff.mts";

export const cmdNpx = defineHandoffCommand({
  name: NPX,
  description: "Run pnpm exec with Socket Firewall security", // socket-hook: allow npx
  spawnMode: "auto",
  examples: ["cowsay", "cowsay@1.6.0 hello"],
  showApiRequirements: true,
  wrapperHint: true,
});
