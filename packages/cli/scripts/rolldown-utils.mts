/**
 * Shared rolldown utilities for Socket CLI builds. Helpers for environment
 * variable inlining, build metadata, and the post-write text transforms
 * (unicode property escapes + env-var replacement) that run over the emitted
 * bundle. Replaces the esbuild equivalents (fleet "Tooling" rule: bundler =
 * rolldown).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDefaultLogger } from "@socketsecurity/lib-stable/logger/default";

import { transformUnicodePropertyEscapes } from "build-infra/lib/unicode-property-escape-transform";

import { EnvironmentVariables } from "./environment-variables.mts";

import type { RolldownOptions } from "rolldown";

const logger = getDefaultLogger();

/**
 * Settings every Socket CLI rolldown config shares. Kept in one place so the
 * target/format/minify defaults can't drift between the index loader and the
 * main CLI bundle. Callers spread this and add variant-specific fields (input,
 * output file, banner, plugins, extra defines).
 *
 * `transform.define` covers the static `process.env.X` reads; the post-write
 * env-var pass in `runBuild` catches the mangled `<id>.env["X"]` forms the
 * static define misses (same two-layer approach esbuild used).
 */
export function createBaseConfig(inlinedEnvVars: Record<string, string>): RolldownOptions {
  return {
    platform: "node",
    transform: {
      define: {
        "process.env.NODE_ENV": '"production"',
        ...createDefineEntries(inlinedEnvVars),
      },
    },
  };
}

/**
 * Dot-notation define keys only. Unlike esbuild, rolldown's oxc define rejects
 * bracket-notation keys (`process.env["KEY"]` → INVALID_DEFINE_CONFIG) — it
 * requires identifier-shaped keys. The dotted `process.env.KEY` form is AST-
 * aware and matches both `.KEY` and `["KEY"]` reads; the mangled
 * `<id>.env["KEY"]` forms the static define can't reach are handled by the
 * post-write `applyEnvVarReplacement` pass.
 */
function createDefineEntries(envVars: Record<string, string>) {
  const entries: Record<string, string> = {};
  for (const { 0: key, 1: value } of Object.entries(envVars)) {
    entries[`process.env.${key}`] = value;
  }
  return entries;
}

/**
 * Standard index loader config.
 */
export function createIndexConfig({
  entryPoint,
  outfile,
}: {
  entryPoint: string;
  outfile: string;
}): RolldownOptions {
  const inlinedEnvVars = getInlinedEnvVars();
  const base = createBaseConfig(inlinedEnvVars);
  return {
    ...base,
    input: entryPoint,
    output: {
      file: outfile,
      format: "cjs",
      minify: false,
      sourcemap: false,
      banner: "#!/usr/bin/env node",
    },
  };
}

/**
 * Replace env vars in built output that survived the static define (handles
 * mangled identifiers like `import_node_process21.default.env["KEY"]`).
 * Operates on the written file text — the post-bundle counterpart of esbuild's
 * onEnd buffer mutation.
 */
export function applyEnvVarReplacement(content: string, envVars: Record<string, string>): string {
  let next = content;
  for (const { 0: key, 1: value } of Object.entries(envVars)) {
    const dq = new RegExp(`(\\w+\\.)+env\\["${key}"\\]`, "g");
    const sq = new RegExp(`(\\w+\\.)+env\\['${key}'\\]`, "g");
    next = next.replace(dq, value).replace(sq, value);
  }
  return next;
}

/**
 * Get all inlined environment variables with their JSON-stringified values.
 */
export function getInlinedEnvVars() {
  return EnvironmentVariables.getDefineEntries();
}

interface RunBuildOptions {
  // Post-write transforms applied to the emitted output text, in order. The
  // unicode-property-escape transform + env-var replacement run here because
  // rolldown (like esbuild) can't express them as a pure config option.
  envVars?: Record<string, string> | undefined;
  unicodeTransform?: boolean | undefined;
}

/**
 * Run a rolldown config, then apply the post-write text transforms to the
 * emitted file. Mirrors esbuild's `write: false` + manual-write flow, but
 * rolldown writes the file and we re-read / transform / re-write it.
 */
export async function runBuild(
  config: RolldownOptions,
  description = "Build",
  options: RunBuildOptions = {},
): Promise<void> {
  const { rolldown } = await import("rolldown");
  const { envVars, unicodeTransform = false } = options;
  try {
    if (description) {
      logger.info(`Building: ${description}`);
    }
    const { output, ...inputOptions } = config;
    if (!output || Array.isArray(output)) {
      throw new Error("Expected a single output config");
    }
    const bundle = await rolldown(inputOptions);
    try {
      await bundle.write(output);
    } finally {
      await bundle.close();
    }

    // Post-write transforms over the emitted file (unicode escapes first, then
    // env-var replacement — order matches the esbuild plugin chain).
    const outFile = (output as { file?: string | undefined }).file;
    if (outFile && (unicodeTransform || envVars)) {
      let content = readFileSync(outFile, "utf8");
      if (unicodeTransform) {
        content = transformUnicodePropertyEscapes(content);
      }
      if (envVars) {
        content = applyEnvVarReplacement(content, envVars);
      }
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, content);
    }

    if (description) {
      logger.success(`${description} complete`);
    }
  } catch (e) {
    logger.error(`Build failed: ${description || "Unknown"}`);
    logger.error(e);
    process.exitCode = 1;
    throw e;
  }
}
