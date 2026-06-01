import { handleApiCall } from "../../util/socket/api.mjs";
import { setupSdk } from "../../util/socket/sdk.mjs";

import type { CResult } from "../../types.mts";
import type { SetupSdkOptions } from "../../util/socket/sdk.mjs";
import type { SocketSdkSuccessResult } from "@socketsecurity/sdk-stable";

type FetchViewRepoOptions = {
  commandPath?: string | undefined;
  sdkOpts?: SetupSdkOptions | undefined;
};

export async function fetchViewRepo(
  orgSlug: string,
  repoName: string,
  options?: FetchViewRepoOptions | undefined,
): Promise<CResult<SocketSdkSuccessResult<"getRepository">["data"]>> {
  const { commandPath, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchViewRepoOptions;

  const sockSdkCResult = await setupSdk(sdkOpts);
  if (!sockSdkCResult.ok) {
    return sockSdkCResult;
  }
  const sockSdk = sockSdkCResult.data;

  return await handleApiCall<"getRepository">(sockSdk.getRepository(orgSlug, repoName), {
    commandPath,
    description: "repository data",
  });
}
