/**
 * Unit tests for update-pnpm-workspace-yaml.
 *
 * Purpose: Tests the YAML-write path used when the host repo declares pnpm@11+
 * in its `packageManager` field. Comments and non-overrides keys must be
 * preserved across edits.
 *
 * Test Coverage: - updatePnpmWorkspaceYamlOverrides.
 *
 * Related Files: - commands/optimize/update-pnpm-workspace-yaml.mts
 * (implementation)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { updatePnpmWorkspaceYamlOverrides } from "../../../../src/commands/optimize/update-pnpm-workspace-yaml.mts";

describe("updatePnpmWorkspaceYamlOverrides", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "socket-cli-yaml-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  it("creates a new pnpm-workspace.yaml when missing", async () => {
    await updatePnpmWorkspaceYamlOverrides(tmpDir, {
      lodash: "4.17.21",
    });
    const yamlPath = path.join(tmpDir, "pnpm-workspace.yaml");
    const content = readFileSync(yamlPath, "utf8");
    expect(content).toContain("overrides:");
    expect(content).toContain("lodash: 4.17.21");
  });

  it("adds an overrides block to an existing file that lacks one", async () => {
    const existing = `# Header comment
packages:
  - .claude/hooks/*

minimumReleaseAge: 10080
`;
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), existing, "utf8");
    await updatePnpmWorkspaceYamlOverrides(tmpDir, {
      lodash: "4.17.21",
    });
    const content = readFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "utf8");
    expect(content).toContain("# Header comment");
    expect(content).toContain("packages:");
    expect(content).toContain("minimumReleaseAge: 10080");
    expect(content).toContain("overrides:");
    expect(content).toContain("lodash: 4.17.21");
  });

  it("merges new entries into an existing overrides block", async () => {
    const existing = `# Header comment
overrides:
  semver: 7.7.4
  glob: '>=13.0.6'

minimumReleaseAge: 10080
`;
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), existing, "utf8");
    await updatePnpmWorkspaceYamlOverrides(tmpDir, {
      lodash: "4.17.21",
    });
    const content = readFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "utf8");
    expect(content).toContain("# Header comment");
    expect(content).toContain("semver: 7.7.4");
    // The original `glob: '>=13.0.6'` constraint must survive the merge.
    expect(content).toContain("glob:");
    expect(content).toContain(">=13.0.6");
    expect(content).toContain("lodash: 4.17.21");
    expect(content).toContain("minimumReleaseAge: 10080");
  });

  it("overwrites existing override values when keys collide", async () => {
    const existing = `overrides:
  lodash: 4.17.20
`;
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), existing, "utf8");
    await updatePnpmWorkspaceYamlOverrides(tmpDir, {
      lodash: "4.17.21",
    });
    const content = readFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "utf8");
    expect(content).toContain("lodash: 4.17.21");
    expect(content).not.toContain("lodash: 4.17.20");
  });

  it("preserves catalog: blocks and other top-level keys", async () => {
    const existing = `packages:
  - .claude/hooks/*

catalog:
  '@socketsecurity/lib-stable': 5.28.0

# Soak window
minimumReleaseAge: 10080
minimumReleaseAgeExclude:
  - '@socketsecurity/*'
`;
    writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), existing, "utf8");
    await updatePnpmWorkspaceYamlOverrides(tmpDir, {
      lodash: "4.17.21",
    });
    const content = readFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "utf8");
    expect(content).toContain("packages:");
    expect(content).toContain(".claude/hooks/*");
    expect(content).toContain("catalog:");
    expect(content).toContain("'@socketsecurity/lib-stable': 5.28.0");
    expect(content).toContain("# Soak window");
    expect(content).toContain("minimumReleaseAge: 10080");
    expect(content).toContain("'@socketsecurity/*'");
    expect(content).toContain("overrides:");
    expect(content).toContain("lodash: 4.17.21");
  });
});
