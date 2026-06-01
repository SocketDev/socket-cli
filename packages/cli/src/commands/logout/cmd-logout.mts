import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import { outputDryRunDelete } from "../../util/dry-run/output.mts";
import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from "../../constants/config.mts";
import { defineFlags } from "../../meow.mts";
import { commonFlags } from "../../flags.mts";
import { meowOrExit } from "../../util/cli/with-subcommands.mjs";
import { isConfigFromFlag, updateConfigValue } from "../../util/config.mts";
import { invalidateDefaultApiToken } from "../../util/socket/sdk.mts";

import type { CliCommandContext } from "../../util/cli/with-subcommands.mjs";
import type { MeowFlags } from "../../flags.mts";

const logger = getDefaultLogger();

export const CMD_NAME = "logout";

const description = "Socket API logout";

const hidden = false;

// Helper functions.

export function applyLogout(): void {
  updateConfigValue(CONFIG_KEY_API_TOKEN, undefined);
  updateConfigValue(CONFIG_KEY_API_BASE_URL, undefined);
  updateConfigValue(CONFIG_KEY_API_PROXY, undefined);
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, undefined);
  invalidateDefaultApiToken();
}

export function attemptLogout(): void {
  try {
    applyLogout();
    logger.success("Successfully logged out");
    if (isConfigFromFlag()) {
      logger.log("");
      logger.warn(
        "Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!",
      );
    }
  } catch {
    logger.fail("Failed to complete logout steps");
  }
}

// Command handler.

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
    }),
    help: (command: string, _config: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options]

    Logs out of the Socket API and clears all Socket credentials from disk

    Examples
      $ ${command}
  `,
  };

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  });

  const dryRun = !!cli.flags["dryRun"];

  if (dryRun) {
    // Runtime read so tests that mutate process.env['HOME'] pick up changes.
    const configPath = `${process.env["HOME"]}/.config/socket/config.json`;
    outputDryRunDelete("Socket API credentials", configPath);
    return;
  }

  attemptLogout();
}

// Exported command.

export const cmdLogout = {
  description,
  hidden,
  run,
};
