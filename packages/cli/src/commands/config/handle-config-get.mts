import { outputConfigGet } from "./output-config-get.mts";
import { getConfigValue } from "../../util/config.mts";

import type { OutputKind } from "../../types.mts";
import type { LocalConfig } from "../../util/config.mts";

export async function handleConfigGet({
  key,
  outputKind,
}: {
  key: keyof LocalConfig;
  outputKind: OutputKind;
}) {
  const result = getConfigValue(key);

  await outputConfigGet(key, result, outputKind);
}
