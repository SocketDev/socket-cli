/**
 * Rolldown configuration for the Socket CLI index loader (the entry point that
 * executes the CLI). Replaces the esbuild config.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createIndexConfig, getInlinedEnvVars, runBuild } from "../scripts/rolldown-utils.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(__dirname, "..");

const config = createIndexConfig({
  entryPoint: path.join(rootPath, "src", "index.mts"),
  outfile: path.join(rootPath, "dist", "index.js"),
});

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  // Index loader has no unicode-escape concerns but still inlines env vars;
  // run the env-var post-write pass for the mangled forms.
  runBuild(config, "Entry point", { envVars: getInlinedEnvVars() }).catch(() => {
    process.exitCode = 1;
  });
}

export default config;
