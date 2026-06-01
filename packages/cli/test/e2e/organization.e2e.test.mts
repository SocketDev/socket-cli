/**
 * @file E2E tests for the `socket organization` command family. Ported from
 *   `packages/cli/test/smoke.sh`'s organization section (45 commands). Covers:
 *   list / policy security / policy license / quota; --json contract
 *   conformance; --org overrides; missing-org and invalid-org error paths
 *   (achieved via per-call `--config` injection instead of mutating the real
 *   config file). Gated on `RUN_E2E_TESTS=1`. Auth-required tests additionally
 *   require a Socket API token.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ENV } from "../../src/constants/env.mts";
import { getDefaultApiToken } from "../../src/util/socket/sdk.mts";
import { executeCliCommand, validateSocketJsonContract } from "../helpers/cli-execution.mts";

const RUN = ENV.RUN_E2E_TESTS;

describe("socket organization (e2e)", () => {
  let hasAuth = false;
  let defaultOrg: string | undefined;

  beforeAll(async () => {
    if (!RUN) {
      return;
    }
    hasAuth = !!(await getDefaultApiToken());
    if (hasAuth) {
      // Resolve the developer's real default org so --org <real> checks have
      // a value. Read it via `config get` rather than poking at the file
      // directly so the CLI's own resolution wins.
      const result = await executeCliCommand(["config", "get", "defaultOrg", "--json"], {
        isolateConfig: false,
      });
      if (result.code === 0) {
        try {
          const payload = JSON.parse(result.stdout) as {
            data?: string | undefined;
          };
          defaultOrg = typeof payload.data === "string" ? payload.data : undefined;
        } catch {
          // Leave undefined — per-org tests skip themselves below.
        }
      }
    }
  });

  describe("help and dry-run (no auth required)", () => {
    it.skipIf(!RUN)("organization (no subcommand) exits 2", async () => {
      const result = await executeCliCommand(["organization"]);
      expect(result.code).toBe(2);
    });

    it.skipIf(!RUN)("organization --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "--dry-run"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization list --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "list", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization list --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "list", "--dry-run"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy (no subcommand) exits 2", async () => {
      const result = await executeCliCommand(["organization", "policy"]);
      expect(result.code).toBe(2);
    });

    it.skipIf(!RUN)("organization policy --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "--dry-run"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy license --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "license", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy license --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "license", "--dry-run"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy security --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "security", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization policy security --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "policy", "security", "--dry-run"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization quota --help exits 0", async () => {
      const result = await executeCliCommand(["organization", "quota", "--help"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN)("organization quota --dry-run exits 0", async () => {
      const result = await executeCliCommand(["organization", "quota", "--dry-run"]);
      expect(result.code).toBe(0);
    });
  });

  describe("list / policy / quota (auth required, scratch-isolated)", () => {
    it.skipIf(!RUN || !hasAuth)("organization list exits 0", async () => {
      const result = await executeCliInScratch(["organization", "list"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)("organization policy license exits 0", async () => {
      const result = await executeCliInScratch(["organization", "policy", "license"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)("organization policy security exits 0", async () => {
      const result = await executeCliInScratch(["organization", "policy", "security"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)("organization quota exits 0", async () => {
      const result = await executeCliInScratch(["organization", "quota"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)("organization policy security --markdown exits 0", async () => {
      const result = await executeCliInScratch([
        "organization",
        "policy",
        "security",
        "--markdown",
      ]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)(
      "organization policy security --json conforms to contract",
      async () => {
        const result = await executeCliInScratch(["organization", "policy", "security", "--json"]);
        expect(result.code).toBe(0);
        validateSocketJsonContract(result.stdout, 0);
      },
    );

    it.skipIf(!RUN || !hasAuth)("organization policy license --markdown exits 0", async () => {
      const result = await executeCliInScratch(["organization", "policy", "license", "--markdown"]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)(
      "organization policy license --json conforms to contract",
      async () => {
        const result = await executeCliInScratch(["organization", "policy", "license", "--json"]);
        expect(result.code).toBe(0);
        validateSocketJsonContract(result.stdout, 0);
      },
    );
  });

  describe("--org <real-default-org> (auth required, scratch-isolated)", () => {
    it.skipIf(!RUN || !hasAuth)("organization policy security --org <real> exits 0", async () => {
      if (!defaultOrg) {
        return;
      }
      const result = await executeCliInScratch([
        "organization",
        "policy",
        "security",
        "--org",
        defaultOrg,
      ]);
      expect(result.code).toBe(0);
    });

    it.skipIf(!RUN || !hasAuth)("organization policy license --org <real> exits 0", async () => {
      if (!defaultOrg) {
        return;
      }
      const result = await executeCliInScratch([
        "organization",
        "policy",
        "license",
        "--org",
        defaultOrg,
      ]);
      expect(result.code).toBe(0);
    });
  });

  describe("--org trash (invalid org, auth required, scratch-isolated)", () => {
    it.skipIf(!RUN || !hasAuth)("organization policy security --org trash exits 1", async () => {
      const result = await executeCliInScratch([
        "organization",
        "policy",
        "security",
        "--org",
        "trash",
      ]);
      expect(result.code).toBe(1);
    });

    it.skipIf(!RUN || !hasAuth)(
      "organization policy security --org trash --markdown exits 1",
      async () => {
        const result = await executeCliInScratch([
          "organization",
          "policy",
          "security",
          "--org",
          "trash",
          "--markdown",
        ]);
        expect(result.code).toBe(1);
      },
    );

    it.skipIf(!RUN || !hasAuth)(
      "organization policy security --org trash --json conforms to error contract",
      async () => {
        const result = await executeCliInScratch([
          "organization",
          "policy",
          "security",
          "--org",
          "trash",
          "--json",
        ]);
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );

    it.skipIf(!RUN || !hasAuth)("organization policy license --org trash exits 1", async () => {
      const result = await executeCliInScratch([
        "organization",
        "policy",
        "license",
        "--org",
        "trash",
      ]);
      expect(result.code).toBe(1);
    });

    it.skipIf(!RUN || !hasAuth)(
      "organization policy license --org trash --markdown exits 1",
      async () => {
        const result = await executeCliInScratch([
          "organization",
          "policy",
          "license",
          "--org",
          "trash",
          "--markdown",
        ]);
        expect(result.code).toBe(1);
      },
    );

    it.skipIf(!RUN || !hasAuth)(
      "organization policy license --org trash --json conforms to error contract",
      async () => {
        const result = await executeCliInScratch([
          "organization",
          "policy",
          "license",
          "--org",
          "trash",
          "--json",
        ]);
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );
  });

  describe("config-driven org resolution (auth required, scratch-isolated)", () => {
    it.skipIf(!RUN || !hasAuth)(
      "policy security with no defaultOrg in config exits 1 (--no-interactive)",
      async () => {
        // No `defaultOrg` in the injected config and --no-interactive prevents
        // the CLI from prompting; failure is the expected outcome.
        const result = await executeCliInScratch(
          ["organization", "policy", "security", "--json", "--no-interactive"],
          { config: {} },
        );
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );

    it.skipIf(!RUN || !hasAuth)(
      "policy license with no defaultOrg in config exits 1 (--no-interactive)",
      async () => {
        const result = await executeCliInScratch(
          ["organization", "policy", "license", "--json", "--no-interactive"],
          { config: {} },
        );
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );

    it.skipIf(!RUN || !hasAuth)(
      "policy security with defaultOrg=fake_org in config exits 1 (--no-interactive)",
      async () => {
        const result = await executeCliInScratch(
          ["organization", "policy", "security", "--json", "--no-interactive"],
          { config: { defaultOrg: "fake_org" } },
        );
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );

    it.skipIf(!RUN || !hasAuth)(
      "policy license with defaultOrg=fake_org in config exits 1 (--no-interactive)",
      async () => {
        const result = await executeCliInScratch(
          ["organization", "policy", "license", "--json", "--no-interactive"],
          { config: { defaultOrg: "fake_org" } },
        );
        expect(result.code).toBe(1);
        validateSocketJsonContract(result.stdout, 1);
      },
    );
  });
});
