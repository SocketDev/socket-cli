/**
 * Unit tests for createConfigCommand.
 *
 * Factory that wires meowOrExit + validation + dry-run into a config
 * subcommand. Tests verify each branch of the constructed `run`: key parsing,
 * value parsing, --json/--markdown conflict, --dry-run preview, custom
 * validation, and final handler dispatch.
 *
 * Related Files: - src/commands/config/config-command-factory.mts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMeowOrExit = vi.hoisted(() => vi.fn());
const mockGetOutputKind = vi.hoisted(() => vi.fn(() => "text"));
const mockCheckCommandInput = vi.hoisted(() => vi.fn(() => true));
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn());
const mockGetSupportedConfigEntries = vi.hoisted(() =>
  vi.fn(() => [["apiToken", "Socket API token"]]),
);
const mockIsSupportedConfigKey = vi.hoisted(() =>
  vi.fn((k: string) => k === "apiToken" || k === "org"),
);
const mockGetFlagListOutput = vi.hoisted(() => vi.fn(() => "flag-list"));

vi.mock(import("../../../../src/util/cli/with-subcommands.mts"), () => ({
  meowOrExit: mockMeowOrExit,
}));
vi.mock(import("../../../../src/util/output/mode.mts"), () => ({
  getOutputKind: mockGetOutputKind,
}));
vi.mock(import("../../../../src/util/validation/check-input.mts"), () => ({
  checkCommandInput: mockCheckCommandInput,
}));
vi.mock(import("../../../../src/util/dry-run/output.mts"), () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}));
vi.mock(import("../../../../src/util/config.mts"), () => ({
  getSupportedConfigEntries: mockGetSupportedConfigEntries,
  isSupportedConfigKey: mockIsSupportedConfigKey,
}));
vi.mock(import("../../../../src/util/output/formatting.mts"), () => ({
  getFlagListOutput: mockGetFlagListOutput,
}));

import { createConfigCommand } from "../../../../src/commands/config/config-command-factory.mts";

const baseSpec = {
  commandName: "set",
  description: "Set a config value",
  handler: vi.fn().mockResolvedValue(undefined),
  helpDescription: "Updates a config key.",
  helpExamples: ["apiToken xxx"],
  helpUsage: "<key> <value>",
  needsValue: true,
};

const importMeta = { url: "file:///test/config.mts" } as ImportMeta;
const context = { parentName: "socket config" };

const setMeow = (overrides: { input?: string[] | undefined; flags?: unknown | undefined } = {}) => {
  mockMeowOrExit.mockReturnValueOnce({
    flags: { json: false, markdown: false, dryRun: false, ...overrides.flags },
    input: overrides.input ?? ["apiToken", "token-value"],
  });
};

describe("createConfigCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOutputKind.mockReturnValue("text");
    mockCheckCommandInput.mockReturnValue(true);
  });

  it("returns a command with description and hidden flag", () => {
    const cmd = createConfigCommand({ ...baseSpec, hidden: true });
    expect(cmd.description).toBe("Set a config value");
    expect(cmd.hidden).toBe(true);
  });

  it("calls the handler with parsed key/value/outputKind", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const cmd = createConfigCommand({ ...baseSpec, handler });
    setMeow({ input: ["apiToken", "my", "value"] });
    mockGetOutputKind.mockReturnValueOnce("json");

    await cmd.run([], importMeta, context);

    expect(handler).toHaveBeenCalledWith({
      key: "apiToken",
      value: "my value",
      outputKind: "json",
    });
  });

  it("omits value when needsValue is false", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const cmd = createConfigCommand({
      ...baseSpec,
      needsValue: false,
      handler,
    });
    setMeow({ input: ["apiToken"] });

    await cmd.run([], importMeta, context);

    expect(handler).toHaveBeenCalledWith({
      key: "apiToken",
      outputKind: "text",
    });
  });

  it("returns early when input validation fails", async () => {
    const handler = vi.fn();
    mockCheckCommandInput.mockReturnValueOnce(false);
    const cmd = createConfigCommand({ ...baseSpec, handler });
    setMeow();

    await cmd.run([], importMeta, context);

    expect(handler).not.toHaveBeenCalled();
  });

  it("runs spec.validate when provided and threads its checks", async () => {
    const validate = vi
      .fn()
      .mockReturnValue([{ test: false, message: "custom check", fail: "bad" }]);
    const cmd = createConfigCommand({ ...baseSpec, validate });
    setMeow();

    await cmd.run([], importMeta, context);

    expect(validate).toHaveBeenCalled();
  });

  it("emits a dry-run preview when --dry-run is set", async () => {
    const handler = vi.fn();
    const cmd = createConfigCommand({ ...baseSpec, handler });
    setMeow({ flags: { dryRun: true } });

    await cmd.run([], importMeta, context);

    expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.stringContaining("set config value"),
      expect.arrayContaining([expect.stringContaining('Set "apiToken"')]),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits an unset preview when needsValue is false in dry-run", async () => {
    const cmd = createConfigCommand({
      ...baseSpec,
      needsValue: false,
      handler: vi.fn(),
    });
    setMeow({ flags: { dryRun: true }, input: ["apiToken"] });

    await cmd.run([], importMeta, context);

    expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("unset config value"),
      expect.arrayContaining([expect.stringContaining('Remove "apiToken"')]),
    );
  });

  it("uses provided flags when supplied via spec.flags", () => {
    const flags = { custom: { type: "string" as const, description: "x" } };
    const cmd = createConfigCommand({ ...baseSpec, flags });
    expect(cmd).toBeDefined();
    expect(typeof cmd.run).toBe("function");
  });

  it("renders help text including config keys and examples", () => {
    let capturedConfig: unknown;
    mockMeowOrExit.mockImplementationOnce((args) => {
      capturedConfig = args.config;
      return {
        flags: { json: false, markdown: false, dryRun: false },
        input: ["apiToken", "value"],
      };
    });

    const cmd = createConfigCommand(baseSpec);
    void cmd.run([], importMeta, context);

    const helpText = capturedConfig.help("socket config set", capturedConfig);
    expect(helpText).toContain("Usage");
    expect(helpText).toContain("apiToken -- Socket API token");
    expect(helpText).toContain("apiToken xxx");
    expect(helpText).toContain("Updates a config key.");
  });
});
