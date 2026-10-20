// Generated from coana-package-manager's packages/coana-cache. Don't edit it here.
// See "Launching Coana" in packages/cli/docs/gcs-releases.md there.

// src/cli.ts
import { cp, readdir as readdir2, rename as rename2, rm as rm3 } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/cache.ts
import { mkdir as mkdir2, open, readdir, readFile, rm as rm2, stat, utimes } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, isAbsolute, join as join2, relative } from "node:path";

// ../utils/src/atomic-fs.ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
async function populateDirAtomically(targetDir, populate) {
  if (existsSync(targetDir)) return;
  const parentDir = dirname(targetDir);
  await mkdir(parentDir, { recursive: true });
  const tmpDir = await mkdtemp(join(parentDir, `.${basename(targetDir)}-`));
  try {
    await populate(tmpDir);
    await chmod(tmpDir, 493);
    await rename(tmpDir, targetDir).catch((e) => {
      if (!existsSync(targetDir)) throw e;
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
    });
  }
}
async function writeFileAtomically(path, data) {
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, data);
    await rename(tmpPath, path);
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {
    });
  }
}

// src/cache.ts
var SHA256 = /^[0-9a-f]{64}$/;
var VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
var COMPONENT = /^[A-Za-z][0-9A-Za-z-]*$/;
var TEMP_DIR = /^\.[0-9a-f]{64}-/;
var ABANDONED_TEMP_DIR_MS = 24 * 60 * 6e4;
function cacheRoot() {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  const cacheHome = xdgCacheHome && isAbsolute(xdgCacheHome) ? xdgCacheHome : join2(homedir(), ".cache");
  return join2(cacheHome, "socket", "coana", "v1");
}
var OUT_OF_SPACE_CODES = /* @__PURE__ */ new Set(["ENOSPC", "EDQUOT"]);
var NOT_WRITABLE_CODES = /* @__PURE__ */ new Set(["EACCES", "EPERM", "EROFS", ...OUT_OF_SPACE_CODES]);
var CacheNotWritable = class _CacheNotWritable extends Error {
  constructor(outOfSpace, cause) {
    super(
      outOfSpace ? `The disk holding the Coana cache in ${cacheRoot()} is out of space (${cause.message}). Free some up, or set XDG_CACHE_HOME to a directory on another disk.` : `Could not write to the Coana cache in ${cacheRoot()} (${cause.message}). Set XDG_CACHE_HOME to a writable directory.`,
      { cause }
    );
  }
  /** `e` as a {@link CacheNotWritable} when it is such a failure of a path in the cache. */
  static from(e) {
    if (e instanceof _CacheNotWritable) return e;
    if (!(e instanceof Error)) return void 0;
    const { code = "", path: source, dest } = e;
    if (!NOT_WRITABLE_CODES.has(code)) return void 0;
    const outOfSpace = OUT_OF_SPACE_CODES.has(code);
    const paths = (outOfSpace && dest !== void 0 ? [dest] : [source, dest]).filter((p) => p !== void 0);
    const ofCache = paths.length === 0 ? outOfSpace : paths.some((path) => within(cacheRoot(), path) || within(path, cacheRoot()));
    return ofCache ? new _CacheNotWritable(outOfSpace, e) : void 0;
    function within(dir, path) {
      const fromDir = relative(dir, path);
      return !fromDir.startsWith("..") && !isAbsolute(fromDir);
    }
  }
};
var InvalidCacheKey = class extends Error {
};
async function writing(f) {
  try {
    return await f();
  } catch (e) {
    throw CacheNotWritable.from(e) ?? e;
  }
}
function objectDir(sha256) {
  return join2(cacheRoot(), "objects", sha256);
}
function versionSegment(version) {
  if (!VERSION.test(version)) throw new InvalidCacheKey(`Invalid Coana version: ${version}`);
  return version;
}
function indexFile(version, component) {
  if (!COMPONENT.test(component)) throw new InvalidCacheKey(`Invalid component name: ${component}`);
  return join2(cacheRoot(), "versions", versionSegment(version), component);
}
async function lookup(version, component) {
  const index = indexFile(version, component);
  const sha256 = (await readFile(index, "utf8").catch(() => "")).trim();
  if (!SHA256.test(sha256)) return void 0;
  const dir = objectDir(sha256);
  const isDirectory = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false
  );
  if (!isDirectory) return void 0;
  const now = /* @__PURE__ */ new Date();
  await utimes(index, now, now).catch(() => writeFileAtomically(index, sha256)).catch(() => {
  });
  return dir;
}
async function install(version, component, sha256, populate) {
  if (!SHA256.test(sha256)) throw new InvalidCacheKey(`Invalid SHA-256: ${sha256}`);
  const index = indexFile(version, component);
  const target = objectDir(sha256);
  await writing(() => mkdir2(dirname2(index), { recursive: true }));
  await writing(
    () => populateDirAtomically(target, (dir) => {
      void sweepAbandonedTempDirs();
      return populate(dir);
    })
  );
  await writing(() => writeFileAtomically(index, sha256));
  return target;
}
var sweeps = /* @__PURE__ */ new Map();
function sweepAbandonedTempDirs() {
  const objects = join2(cacheRoot(), "objects");
  let sweep = sweeps.get(objects);
  if (sweep === void 0) {
    sweep = removeAbandoned();
    sweeps.set(objects, sweep);
  }
  return sweep;
  async function removeAbandoned() {
    const names = await readdir(objects).catch(() => []);
    await Promise.all(
      names.filter((name) => TEMP_DIR.test(name)).map(async (name) => {
        const dir = join2(objects, name);
        const age = await ageMs(dir);
        if (age !== void 0 && age > ABANDONED_TEMP_DIR_MS)
          await rm2(dir, { recursive: true, force: true }).catch(() => {
          });
      })
    );
  }
}
async function ageMs(path) {
  return stat(path).then(
    (s) => Date.now() - s.ctimeMs,
    () => void 0
  );
}

// src/cli.ts
var USAGE = `usage: coana-cache.mjs lookup <version> <component>
       coana-cache.mjs install <version> <component> <sha256> <extracted-dir>`;
var NOT_CACHED = 4;
async function main(args) {
  const [command, ...rest] = args;
  if (command === "lookup" && rest.length === 2) {
    const [version, component] = rest;
    const dir = await lookup(version, component);
    if (dir === void 0) return NOT_CACHED;
    process.stdout.write(`${dir}
`);
    return 0;
  }
  if (command === "install" && rest.length === 4) {
    const [version, component, sha256, extracted] = rest;
    const dir = await install(version, component, sha256, (tmp) => moveInto(extracted, tmp));
    await rm3(extracted, { recursive: true, force: true }).catch(() => {
    });
    process.stdout.write(`${dir}
`);
    return 0;
  }
  process.stderr.write(`${USAGE}
`);
  return 2;
  async function moveInto(extractedDir, dir) {
    for (const name of await readdir2(extractedDir)) {
      const from = join3(extractedDir, name);
      const to = join3(dir, name);
      try {
        await rename2(from, to);
      } catch (e) {
        if (e.code !== "EXDEV") throw e;
        await cp(from, to, { recursive: true, verbatimSymlinks: true });
      }
    }
  }
}
process.exitCode = await main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}
`);
  if (e instanceof InvalidCacheKey) return 2;
  return e instanceof CacheNotWritable ? 3 : 1;
});
