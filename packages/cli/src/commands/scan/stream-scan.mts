import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import { handleApiCall } from "../../util/socket/api.mjs";
import { setupSdk } from "../../util/socket/sdk.mjs";

import type { SetupSdkOptions } from "../../util/socket/sdk.mjs";

const logger = getDefaultLogger();

type StreamScanOptions = {
  commandPath?: string | undefined;
  file?: string | undefined;
  sdkOpts?: SetupSdkOptions | undefined;
};

export async function streamScan(
  orgSlug: string,
  scanId: string,
  options?: StreamScanOptions | undefined,
) {
  const { commandPath, file, sdkOpts } = {
    __proto__: null,
    ...options,
  } as StreamScanOptions;
  const sockSdkCResult = await setupSdk(sdkOpts);
  if (!sockSdkCResult.ok) {
    return sockSdkCResult;
  }
  const sockSdk = sockSdkCResult.data;

  logger.info("Requesting data from API…");

  // Note: This will write to stdout or target file. It is not a noop.
  return await handleApiCall<"getOrgFullScan">(
    sockSdk.streamFullScan(orgSlug, scanId, {
      output: file === "-" ? undefined : file,
    }),
    {
      commandPath,
      description: "a scan",
    },
  );
}
