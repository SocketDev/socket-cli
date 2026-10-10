#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const GITHUB_ORIGIN = "https://github.com";
function integrityValue(integrity) {
  if (typeof integrity === "object" && integrity !== null) {
    const value = integrity.value;
    return typeof value === "string" ? value : "";
  }
  return typeof integrity === "string" ? integrity : "";
}
function integrityProvenance(integrity) {
  if (typeof integrity === "object" && integrity !== null) {
    const record = integrity;
    return {
      __proto__: null,
      src: typeof record.src === "string" ? record.src : "",
      date: typeof record.date === "string" ? record.date : "",
    };
  }
  return {
    __proto__: null,
    src: "",
    date: "",
  };
}
function safeReleaseSegment(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    /[/\\?#\u0000-\u0020]/u.test(value)
  )
    throw new Error(
      `external-tools.json ${label} is not a safe GitHub release path segment`,
    );
  return value;
}
function githubRepositorySlug(repository) {
  if (typeof repository !== "string" || !repository.startsWith("github:"))
    throw new Error(
      "external-tools.json repository is not a github:owner/repo reference",
    );
  const slug = repository.slice(7);
  const parts = slug.split("/");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))
  )
    throw new Error(
      "external-tools.json repository is not a github:owner/repo reference",
    );
  return slug;
}
/**
 * Resolve a pinned GitHub release asset and verify its URL binding.
 */
function resolveGithubReleaseAsset(tool, entry, canonicalKey) {
  const slug = githubRepositorySlug(tool.repository);
  const tag = safeReleaseSegment(tool.tag, "tag");
  const assetName = safeReleaseSegment(entry.asset, "platform asset");
  const pathname = `/${slug}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
  const asset = new URL(pathname, GITHUB_ORIGIN);
  if (
    asset.origin !== GITHUB_ORIGIN ||
    asset.pathname !== pathname ||
    asset.username ||
    asset.password ||
    asset.search ||
    asset.hash
  )
    throw new Error(
      `external-tools.json ${canonicalKey} release asset URL failed GitHub binding validation`,
    );
  const integrity = integrityValue(entry.integrity);
  if (!integrity)
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing integrity`,
    );
  const { src, date } = integrityProvenance(entry.integrity);
  return {
    __proto__: null,
    asset: asset.href,
    assetName,
    integrity,
    repository: slug,
    src,
    date,
    tag,
    version: String(tool.version ?? ""),
  };
}
/**
 * Resolve a catalog asset while preserving its exact integrity metadata.
 */
function resolveCatalogAsset(tool, entry, canonicalKey) {
  if (
    tool.origin === "gh-asset" ||
    (typeof tool.repository === "string" &&
      tool.repository.startsWith("github:"))
  )
    return resolveGithubReleaseAsset(tool, entry, canonicalKey);
  const asset = entry.asset;
  const integrity = integrityValue(entry.integrity);
  if (typeof asset !== "string" || !asset.startsWith("https://"))
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing an HTTPS asset URL`,
    );
  if (!integrity)
    throw new Error(
      `external-tools.json ${canonicalKey} entry is missing integrity`,
    );
  const { src, date } = integrityProvenance(entry.integrity);
  return {
    __proto__: null,
    asset,
    integrity,
    src,
    date,
    version: String(tool.version ?? ""),
  };
}

const GO_OS_ARCH = {
  __proto__: null,
  "darwin-arm64": {
    os: "darwin",
    arch: "arm64",
  },
  "darwin-x64": {
    os: "darwin",
    arch: "amd64",
  },
  "linux-arm64": {
    os: "linux",
    arch: "arm64",
  },
  "linux-arm64-musl": {
    os: "linux",
    arch: "arm64",
  },
  "linux-x64": {
    os: "linux",
    arch: "amd64",
  },
  "linux-x64-musl": {
    os: "linux",
    arch: "amd64",
  },
  "win32-arm64": {
    os: "windows",
    arch: "arm64",
  },
  "win32-x64": {
    os: "windows",
    arch: "amd64",
  },
};
function canonicalPlatformKey() {
  const arch = {
    __proto__: null,
    arm64: "arm64",
    x64: "x64",
  }[process.arch];
  if (!arch) throw new Error(`unsupported arch: ${process.arch}`);
  let platform;
  if (process.platform === "darwin") platform = "darwin";
  else if (process.platform === "linux") platform = "linux";
  else if (process.platform === "win32") platform = "win32";
  else throw new Error(`unsupported platform: ${process.platform}`);
  let suffix = "";
  if (platform === "linux") {
    const libc = process.report?.getReport?.()?.header?.glibcVersionRuntime;
    if (libc === "musl") suffix = "-musl";
    else if (!libc) {
      if (
        ["/lib", "/lib64"].some((directory) => {
          if (!existsSync(directory)) return false;
          try {
            return readdirSync(directory).some((file) =>
              file.startsWith("ld-musl-"),
            );
          } catch {
            return false;
          }
        })
      )
        suffix = "-musl";
    }
  }
  return `${platform}-${arch}${suffix}`;
}
function resolvePlatformEntry(platforms, canonicalKey) {
  const entry = platforms[canonicalKey];
  if (entry)
    return {
      __proto__: null,
      entry,
      fallbackKey: void 0,
    };
  if (canonicalKey.endsWith("-musl")) {
    const glibcKey = canonicalKey.slice(0, -5);
    const fallback = platforms[glibcKey];
    if (fallback)
      return {
        __proto__: null,
        entry: fallback,
        fallbackKey: glibcKey,
      };
  }
  return {
    __proto__: null,
    entry: void 0,
    fallbackKey: void 0,
  };
}
function readVersionFromFile(file) {
  if (!file || !existsSync(file)) return "";
  const src = readFileSync(file, "utf8");
  return /^go\s+(\d+\.\d+(?:\.\d+)?)/m.exec(src)?.[1] ?? "";
}
function resolveGoAssetFromManifest(manifest, version, canonicalKey) {
  const goOsArch = GO_OS_ARCH[canonicalKey];
  if (!goOsArch) throw new Error(`go: no os/arch mapping for ${canonicalKey}`);
  const want = `go${version}`;
  const release = Array.isArray(manifest)
    ? manifest.find((item) => item.version === want && item.stable)
    : void 0;
  if (!release)
    throw new Error(
      `go.dev manifest has no stable release '${want}' (resolved version ${version})`,
    );
  const file = Array.isArray(release.files)
    ? release.files.find(
        (item) =>
          item.os === goOsArch.os &&
          item.arch === goOsArch.arch &&
          item.kind === "archive",
      )
    : void 0;
  if (!file || !file.sha256 || !file.filename)
    throw new Error(
      `go.dev release ${want} has no archive for ${goOsArch.os}-${goOsArch.arch}`,
    );
  return {
    __proto__: null,
    asset: `https://go.dev/dl/${file.filename}`,
    integrity: `sha256-${file.sha256}`,
    version: String(version),
  };
}

/**
 * @file Resolve a pinned external-tool asset + SRI integrity for THIS runner,
 *   from scripts/fleet/setup/external-tools.json. Replaces the curl-with-no-
 *   checksum download dance repeated across setup-go-toolchain /
 *   setup-rust-toolchain / setup-odai. Emits one JSON line on stdout:
 *   {"asset":"<url>","integrity":"<sri>","version":"<v>"}
 *   The caller passes `asset` + `integrity` to install-tool.mjs, which
 *   downloads + SRI-verifies BEFORE extract/execute. Usage:
 *   node resolve-external-tool-asset.generated.mjs --tool <name>
 *   [--version <v>] [--version-file <path>] [--tools-file <path>]
 *   [--platform-key <key>]
 *   --version "stable" (or omitted) → the entry's pinned `version`.
 *   --version-file → read a `go <version>` line (go.mod) and use that version.
 *   For `go` ONLY, a version that differs from the pin is resolved live
 *   against the go.dev release manifest (https://go.dev/dl/?mode=json) so a
 *   custom Go version still gets a SHA-256-verified download; every other tool
 *   requires the pinned version (the pin IS the integrity source). Exits 1 on
 *   any resolution failure. A validated catalog with no asset for the selected
 *   platform exits with PLATFORM_UNAVAILABLE_EXIT_CODE for optional callers.
 *   Runs on the raw runner before setup-node (composite-action helper), so it
 *   uses built-ins only (node:fs, node:path, node:process, fetch) — no
 *   socket-lib, no node_modules.
 *   Testability: the pure helpers (canonicalPlatformKey, resolvePlatformEntry,
 *   integrityValue, readVersionFromFile, resolveGoAssetFromManifest) are
 *   EXPORTED and the side-effectful CLI orchestration is guarded by
 *   isMainModule(), so unit tests import them without triggering a network
 *   fetch or a process.exit. Every composite-action _shared helper follows this
 *   pattern (see check-fleet-shared-scripts-are-testable).
 */
const PLATFORM_UNAVAILABLE_EXIT_CODE = 42;
function errorMessage(error) {
  if (error instanceof Error) return error.message || "Unknown error";
  if (error === null || error === void 0) return "Unknown error";
  const message = String(error);
  if (message === "" || message === "[object Object]") return "Unknown error";
  return message;
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
function fail(msg) {
  console.error(msg);
}
function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length
    ? (process.argv[i + 1] ?? "")
    : "";
}
function loadToolsCatalog(toolsFileArg) {
  const toolsFile =
    toolsFileArg ||
    fileURLToPath(
      new URL("../setup/external-tools.generated.json", import.meta.url),
    );
  if (!existsSync(toolsFile)) {
    fail(`× external-tools.json not found at ${toolsFile}`);
    process.exit(1);
  }
  let toolsData;
  try {
    toolsData = JSON.parse(readFileSync(toolsFile, "utf8"));
  } catch (e) {
    fail(`× could not parse ${toolsFile}: ${errorMessage(e)}`);
    process.exit(1);
  }
  const tools = isPlainObject(toolsData) ? toolsData["tools"] : void 0;
  if (!isPlainObject(tools)) {
    fail(`× ${toolsFile} has no valid tools map`);
    process.exit(1);
  }
  return {
    __proto__: null,
    tools,
    toolsFile,
  };
}
function selectToolEntry(tools, toolName, toolsFile) {
  const tool = tools[toolName];
  if (!isPlainObject(tool)) {
    fail(`× no '${toolName}' entry in ${toolsFile}`);
    process.exit(1);
  }
  const platforms = tool["platforms"];
  if (!isPlainObject(platforms)) {
    fail(`× '${toolName}' has no platforms map in ${toolsFile}`);
    process.exit(1);
  }
  for (const [platformKey, entry] of Object.entries(platforms))
    if (
      !isPlainObject(entry) ||
      typeof entry["asset"] !== "string" ||
      entry["asset"].length === 0 ||
      !integrityValue(entry["integrity"])
    ) {
      fail(
        `× '${toolName}' has a malformed ${platformKey} platform entry in ${toolsFile}`,
      );
      process.exit(1);
    }
  return tool;
}
function resolveToolVersion({ tool, toolName, versionArg, versionFile }) {
  const fileVersion = readVersionFromFile(versionFile);
  let resolvedVersion = "";
  if (fileVersion) resolvedVersion = fileVersion;
  else if (versionArg && versionArg !== "stable") resolvedVersion = versionArg;
  if (!resolvedVersion)
    resolvedVersion = typeof tool.version === "string" ? tool.version : "";
  if (!resolvedVersion) {
    fail(`× no version resolved for '${toolName}' (no pin, no input)`);
    process.exit(1);
  }
  if (
    !(toolName === "go" || tool.manager === "go") &&
    resolvedVersion !== tool.version
  ) {
    fail(
      `× '${toolName}' only accepts its pinned catalog version ${tool.version}`,
    );
    process.exit(1);
  }
  return resolvedVersion;
}
function emitPinnedAsset(
  tool,
  entry,
  { canonicalKey, resolvedVersion, toolsFile },
) {
  try {
    emit({
      ...resolveCatalogAsset(tool, entry, canonicalKey),
      version: resolvedVersion,
    });
  } catch (error) {
    fail(`× ${errorMessage(error)} in ${toolsFile}`);
    process.exit(1);
  }
}
async function fetchGoDlManifest() {
  try {
    const res = await fetch("https://go.dev/dl/?mode=json&include=all", {
      redirect: "follow",
    });
    if (!res.ok) {
      fail(`× go.dev manifest fetch failed: HTTP ${res.status}`);
      process.exit(1);
    }
    return await res.json();
  } catch (e) {
    fail(`× go.dev manifest fetch failed: ${errorMessage(e)}`);
    process.exit(1);
  }
}
async function main() {
  const toolName = argValue("--tool");
  const versionArg = argValue("--version");
  const versionFile = argValue("--version-file");
  const toolsFileArg = argValue("--tools-file");
  const platformArg = argValue("--platform-key");
  if (!toolName) {
    fail(
      "usage: resolve-external-tool-asset.generated.mjs --tool <name> [--version <v>] [--version-file <path>] [--tools-file <path>]",
    );
    process.exit(1);
  }
  const { tools, toolsFile } = loadToolsCatalog(toolsFileArg);
  const tool = selectToolEntry(tools, toolName, toolsFile);
  const canonicalKey = platformArg || canonicalPlatformKey();
  const { entry, fallbackKey } = resolvePlatformEntry(
    tool.platforms,
    canonicalKey,
  );
  if (fallbackKey)
    fail(
      `· ${toolName}: no ${canonicalKey} asset, falling back to ${fallbackKey} (statically linked, runs on musl)`,
    );
  if (!entry) {
    fail(
      `× '${toolName}' has no platform asset for ${canonicalKey} in ${toolsFile}`,
    );
    process.exit(42);
  }
  const resolvedVersion = resolveToolVersion({
    tool,
    toolName,
    versionArg,
    versionFile,
  });
  const isGo = toolName === "go" || tool.manager === "go";
  const pinVersion = tool.version || "";
  if (!isGo || resolvedVersion === pinVersion) {
    emitPinnedAsset(tool, entry, {
      canonicalKey,
      resolvedVersion,
      toolsFile,
    });
    return;
  }
  const manifest = await fetchGoDlManifest();
  try {
    emit(resolveGoAssetFromManifest(manifest, resolvedVersion, canonicalKey));
  } catch (e) {
    fail(`× ${errorMessage(e)}`);
    process.exit(1);
  }
}
if (isMainModule()) main();

export {
  GO_OS_ARCH,
  PLATFORM_UNAVAILABLE_EXIT_CODE,
  canonicalPlatformKey,
  integrityProvenance,
  integrityValue,
  readVersionFromFile,
  resolveCatalogAsset,
  resolveGithubReleaseAsset,
  resolveGoAssetFromManifest,
  resolvePlatformEntry,
};
