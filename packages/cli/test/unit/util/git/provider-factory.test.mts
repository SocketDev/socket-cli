/**
 * Unit tests for createPrProvider.
 *
 * Picks GitHubProvider or GitLabProvider based on the remote URL.
 *
 * Test Coverage:
 *
 * - Gitlab.com remote → GitLabProvider
 * - GITLAB_HOST env set → GitLabProvider
 * - Generic 'gitlab' substring → GitLabProvider
 * - Github remote → GitHubProvider (default)
 * - GetGitRemoteUrlSync returns trimmed lowercase string on success
 * - GetGitRemoteUrlSync returns '' on non-zero exit
 * - GetGitRemoteUrlSync returns '' on spawn throw
 *
 * Related Files:
 *
 * - Src/util/git/provider-factory.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));

vi.mock(import("@socketsecurity/lib-stable/process/spawn/child"), () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock(import("../../../../src/util/git/github-provider.mts"), () => ({
  GitHubProvider: class GitHubProviderMock {
    readonly kind = "github" as const;
  },
}));

vi.mock(import("../../../../src/util/git/gitlab-provider.mts"), () => ({
  GitLabProvider: class GitLabProviderMock {
    readonly kind = "gitlab" as const;
  },
}));

const { createPrProvider, getGitRemoteUrlSync } =
  await import("../../../../src/util/git/provider-factory.mts");

const savedGitlabHost = process.env["GITLAB_HOST"];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env["GITLAB_HOST"];
});

afterEach(() => {
  if (savedGitlabHost === undefined) {
    delete process.env["GITLAB_HOST"];
  } else {
    process.env["GITLAB_HOST"] = savedGitlabHost;
  }
});

describe("createPrProvider", () => {
  it("returns GitLabProvider when remote points at gitlab.com", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "git@gitlab.com:org/repo.git\n",
    });
    const provider = createPrProvider() as { kind: string };
    expect(provider.kind).toBe("gitlab");
  });

  it("returns GitLabProvider when GITLAB_HOST env is set", () => {
    process.env["GITLAB_HOST"] = "gitlab.example.com";
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "git@github.com:org/repo.git\n",
    });
    const provider = createPrProvider() as { kind: string };
    expect(provider.kind).toBe("gitlab");
  });

  it('returns GitLabProvider when remote URL contains "gitlab"', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "git@self-hosted-gitlab.example.com:org/repo.git\n",
    });
    const provider = createPrProvider() as { kind: string };
    expect(provider.kind).toBe("gitlab");
  });

  it("returns GitHubProvider for github remotes", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "git@github.com:org/repo.git\n",
    });
    const provider = createPrProvider() as { kind: string };
    expect(provider.kind).toBe("github");
  });

  it("falls back to GitHubProvider when remote is unknown", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "git@bitbucket.example.com:org/repo.git\n",
    });
    const provider = createPrProvider() as { kind: string };
    expect(provider.kind).toBe("github");
  });
});

describe("getGitRemoteUrlSync", () => {
  it("returns trimmed lowercased URL on success", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "  HTTPS://Github.COM/Org/Repo.git  \n",
    });
    expect(getGitRemoteUrlSync()).toBe("https://github.com/org/repo.git");
  });

  it("returns empty string when git config exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "" });
    expect(getGitRemoteUrlSync()).toBe("");
  });

  it("returns empty string when stdout is empty even on status 0", () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "" });
    expect(getGitRemoteUrlSync()).toBe("");
  });

  it("returns empty string when spawnSync throws", () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    expect(getGitRemoteUrlSync()).toBe("");
  });
});
