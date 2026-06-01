/**
 * @file E2E tests for `socket oops`. Ported from `packages/cli/test/smoke.sh`'s
 *   oops section (4 commands). `oops` is a deliberate-failure command used in
 *   regression tests; the no-arg form exits 1 by design. Gated on
 *   `RUN_E2E_TESTS=1`.
 */

import { describe, expect, it } from "vitest";

import { ENV } from "../../src/constants/env.mts";
import { executeCliCommand } from "../helpers/cli-execution.mts";

const RUN = ENV.RUN_E2E_TESTS;

describe("socket oops (e2e)", () => {
  it.skipIf(!RUN)("oops (no args) exits 1 by design", async () => {
    const result = await executeCliCommand(["oops"]);
    expect(result.code).toBe(1);
  });

  it.skipIf(!RUN)("oops --help exits 0", async () => {
    const result = await executeCliCommand(["oops", "--help"]);
    expect(result.code).toBe(0);
  });

  it.skipIf(!RUN)("oops --dry-run exits 0", async () => {
    const result = await executeCliCommand(["oops", "--dry-run"]);
    expect(result.code).toBe(0);
  });
});
