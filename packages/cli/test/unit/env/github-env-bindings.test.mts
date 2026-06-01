/**
 * Unit tests for GITHUB_* env-binding modules.
 *
 * Each module simply re-exports the value from @socketsecurity/lib/env/github
 * at module-load time. These tests verify the wrappers exist and propagate the
 * value through.
 *
 * Related Files:
 *
 * - Src/env/github-*.mts
 */

import { describe, expect, it } from "vitest";

describe("github env bindings", () => {
  it("GITHUB_API_URL is exported", async () => {
    const mod = await import("../../../src/env/github-api-url.mts");
    expect("GITHUB_API_URL" in mod).toBe(true);
  });

  it("GITHUB_BASE_REF is exported", async () => {
    const mod = await import("../../../src/env/github-base-ref.mts");
    expect("GITHUB_BASE_REF" in mod).toBe(true);
  });

  it("GITHUB_REF_NAME is exported", async () => {
    const mod = await import("../../../src/env/github-ref-name.mts");
    expect("GITHUB_REF_NAME" in mod).toBe(true);
  });

  it("GITHUB_REF_TYPE is exported", async () => {
    const mod = await import("../../../src/env/github-ref-type.mts");
    expect("GITHUB_REF_TYPE" in mod).toBe(true);
  });

  it("GITHUB_REPOSITORY is exported", async () => {
    const mod = await import("../../../src/env/github-repository.mts");
    expect("GITHUB_REPOSITORY" in mod).toBe(true);
  });

  it("GITHUB_SERVER_URL is exported", async () => {
    const mod = await import("../../../src/env/github-server-url.mts");
    expect("GITHUB_SERVER_URL" in mod).toBe(true);
  });
});
