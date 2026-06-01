/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import {
  getConfigValue,
  getSupportedConfigKeys,
  isConfigFromFlag,
  isSensitiveConfigKey,
} from "../../util/config.mts";
import { mdHeader } from "../../util/output/markdown.mts";
import { serializeResultJson } from "../../util/output/result-json.mjs";

import type { OutputKind } from "../../types.mts";
const logger = getDefaultLogger();

export async function outputConfigList({
  full,
  outputKind,
}: {
  full: boolean;
  outputKind: OutputKind;
}) {
  const readOnly = isConfigFromFlag();
  const supportedConfigKeys = getSupportedConfigKeys();
  if (outputKind === "json") {
    let failed = false;
    const obj: Record<string, unknown> = {};
    for (let i = 0, { length } = supportedConfigKeys; i < length; i += 1) {
      const key = supportedConfigKeys[i]!;
      const result = getConfigValue(key);
      let value = result.data;
      if (!result.ok) {
        value = `Failed to retrieve: ${result.message}`;
        failed = true;
      } else if (!full && isSensitiveConfigKey(key)) {
        value = "********";
      }
      if (full || value !== undefined) {
        obj[key] = value ?? "<none>";
      }
    }
    if (failed) {
      process.exitCode = 1;
    }
    logger.log(
      serializeResultJson(
        failed
          ? {
              ok: false,
              message: "At least one config key failed to be fetched…",
              data: JSON.stringify({
                full,
                config: obj,
                readOnly,
              }),
            }
          : {
              ok: true,
              data: {
                full,
                config: obj,
                readOnly,
              },
            },
      ),
    );
  } else {
    const maxWidth = supportedConfigKeys.reduce((a, b) => Math.max(a, b.length), 0);

    logger.log(mdHeader("Local CLI Config"));
    logger.log("");
    logger.log(`This is the local CLI config (full=${!!full}):`);
    logger.log("");
    for (let i = 0, { length } = supportedConfigKeys; i < length; i += 1) {
      const key = supportedConfigKeys[i]!;
      const result = getConfigValue(key);
      if (!result.ok) {
        logger.log(`- ${key}: failed to read: ${result.message}`);
      } else {
        let value = result.data;
        if (!full && isSensitiveConfigKey(key)) {
          value = "********";
        }
        if (full || value !== undefined) {
          logger.log(
            `- ${key}:${" ".repeat(Math.max(0, maxWidth - key.length + 3))} ${Array.isArray(value) ? value.join(", ") || "<none>" : (value ?? "<none>")}`,
          );
        }
      }
    }
    if (readOnly) {
      logger.log("");
      logger.log(
        "Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.",
      );
    }
  }
}
