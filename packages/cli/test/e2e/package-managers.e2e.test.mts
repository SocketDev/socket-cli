/**
 * @file E2E tests for Socket CLI's package-manager wrappers. Ported from
 *   `packages/cli/test/smoke.sh`'s npm / npx / raw-npm / raw-npx / wrapper /
 *   optimize / cdxgen / dependencies sections. Covers: help / dry-run paths for
 *   each wrapper; the wrapper on/off toggle (scratch-isolated so the
 *   developer's real shim install isn't touched); `dependencies` listing +
 *   pagination flags; `cdxgen`'s no-arg invocation; `optimize` flag matrix.
 *   Gated on `RUN_E2E_TESTS=1`. `dependencies` against the org list needs auth;
 *   `cdxgen` needs a real cdxgen install on PATH.
 */

import { describe, expect, it } from "vitest";

import { ENV } from "../../src/constants/env.mts";
import {
  executeCliCommand,
  executeCliInScratch,
  validateSocketJsonContract,
} from "../helpers/cli-execution.mts";

const RUN = ENV.RUN_E2E_TESTS;

describe("socket npm wrapper (e2e)", () => {
  it.skipIf(!RUN)("npm --help exits 0", async () => {
    const result = await executeCliCommand(["npm", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("npm --dry-run exits 0", async () => {
    const result = await executeCliCommand(["npm", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("npm info exits 0", async () => {
    // Scratch so npm's ~/.npm cache isn't written into the dev's home.
    const result = await executeCliInScratch(["npm", "info"]);
    expect(result.code).toBe(0);
  });
});

describe("socket npx wrapper (e2e)", () => {
  it.skipIf(!RUN)("npx --help exits 0", async () => {
    const result = await executeCliCommand(["npx", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("npx --dry-run exits 0", async () => {
    const result = await executeCliCommand(["npx", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("npx cowsay moo exits 0", async () => {
    // npx downloads cowsay into npm cache — pin to scratch.
    const result = await executeCliInScratch(["npx", "cowsay", "moo"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("npx socket --dry-run exits 0", async () => {
    const result = await executeCliInScratch(["npx", "socket", "--dry-run"]);
    expect(result.code).toBe(0);
  });
});

describe("socket raw-npm (e2e)", () => {
  it.skipIf(!RUN)("raw-npm (no args) exits 1", async () => {
    // raw-npm may invoke real npm which writes to ~/.npm; scratch isolates.
    const result = await executeCliInScratch(["raw-npm"]);
    expect(result.code).toBe(1);
  });

  it.skipIf(!RUN)("raw-npm --help exits 0", async () => {
    const result = await executeCliCommand(["raw-npm", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("raw-npm --dry-run exits 0", async () => {
    const result = await executeCliCommand(["raw-npm", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("raw-npm info exits 0", async () => {
    const result = await executeCliInScratch(["raw-npm", "info"]);
    expect(result.code).toBe(0);
  });
});

describe("socket raw-npx (e2e)", () => {
  it.skipIf(!RUN)("raw-npx --help exits 0", async () => {
    const result = await executeCliCommand(["raw-npx", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("raw-npx --dry-run exits 0", async () => {
    const result = await executeCliCommand(["raw-npx", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("raw-npx cowsay moo exits 0", async () => {
    const result = await executeCliInScratch(["raw-npx", "cowsay", "moo"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("raw-npx socket --dry-run exits 0", async () => {
    const result = await executeCliInScratch(["raw-npx", "socket", "--dry-run"]);
    expect(result.code).toBe(0);
  });
});

describe("socket wrapper toggle (e2e, scratch-isolated)", () => {
  it.skipIf(!RUN)("wrapper (no subcommand) exits 2", async () => {
    const result = await executeCliCommand(["wrapper"]);
    expect(result.code).toBe(2);
  });

  it.skipIf(!RUN)("wrapper --help exits 0", async () => {
    const result = await executeCliCommand(["wrapper", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("wrapper --dry-run (no on/off) exits 2", async () => {
    const result = await executeCliCommand(["wrapper", "--dry-run"]);
    expect(result.code).toBe(2);
  });

  it.skipIf(!RUN)("wrapper on exits 0", async () => {
    const result = await executeCliInScratch(["wrapper", "on"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("wrapper off exits 0", async () => {
    const result = await executeCliInScratch(["wrapper", "off"]);
    expect(result.code).toBe(0);
  });
});

describe("socket optimize (e2e)", () => {
  it.skipIf(!RUN)("optimize --help exits 0", async () => {
    const result = await executeCliCommand(["optimize", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("optimize --dry-run exits 0", async () => {
    const result = await executeCliCommand(["optimize", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("optimize exits 0", async () => {
    const result = await executeCliInScratch(["optimize"], {
      seedFiles: {
        "package.json": JSON.stringify({
          name: "socket-cli-e2e-optimize",
          version: "0.0.0",
        }),
      },
    });
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("optimize --prod exits 0", async () => {
    const result = await executeCliInScratch(["optimize", "--prod"], {
      seedFiles: {
        "package.json": JSON.stringify({
          name: "socket-cli-e2e-optimize",
          version: "0.0.0",
        }),
      },
    });
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("optimize --pin exits 0", async () => {
    const result = await executeCliInScratch(["optimize", "--pin"], {
      seedFiles: {
        "package.json": JSON.stringify({
          name: "socket-cli-e2e-optimize",
          version: "0.0.0",
        }),
      },
    });
    expect(result.code).toBe(0);
  });
});

describe("socket cdxgen (e2e)", () => {
  it.skipIf(!RUN)("cdxgen (no args, no real cdxgen on PATH) exits 1", async () => {
    // cdxgen may write SBOM artifacts into cwd if it succeeds; scratch keeps
    // them out of the dev's repo.
    const result = await executeCliInScratch(["cdxgen"]);
    expect(result.code).toBe(1);
  });
});

describe("socket organization dependencies (e2e, auth required, scratch-isolated)", () => {
  it.skipIf(!RUN)("organization dependencies --help exits 0", async () => {
    const result = await executeCliCommand(["organization", "dependencies", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies --dry-run exits 0", async () => {
    const result = await executeCliCommand(["organization", "dependencies", "--dry-run"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies exits 0", async () => {
    const result = await executeCliInScratch(["organization", "dependencies"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies --json conforms to contract", async () => {
    const result = await executeCliInScratch(["organization", "dependencies", "--json"]);
    expect(result.code).toBe(0);
    validateSocketJsonContract(result.stdout, 0);
  });

  it.skipIf(!RUN)("organization dependencies --markdown exits 0", async () => {
    const result = await executeCliInScratch(["organization", "dependencies", "--markdown"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies --limit 1 exits 0", async () => {
    const result = await executeCliInScratch(["organization", "dependencies", "--limit", "1"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies --offset 5 exits 0", async () => {
    const result = await executeCliInScratch(["organization", "dependencies", "--offset", "5"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("organization dependencies --limit 1 --offset 10 exits 0", async () => {
    const result = await executeCliInScratch([
      "organization",
      "dependencies",
      "--limit",
      "1",
      "--offset",
      "10",
    ]);
    expect(result.code).toBe(0);
  });
});
