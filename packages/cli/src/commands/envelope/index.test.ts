import { Command } from "commander";
import type { SubprocessRunner } from "@clef-sh/core";
import { registerEnvelopeCommand } from "./index";

const fakeRunner = {} as SubprocessRunner;

describe("registerEnvelopeCommand", () => {
  it("registers 'envelope' as a top-level command with 'inspect' subcommand", () => {
    const program = new Command();
    registerEnvelopeCommand(program, { runner: fakeRunner });

    const envelopeCmd = program.commands.find((c) => c.name() === "envelope");
    expect(envelopeCmd).toBeDefined();

    const inspect = envelopeCmd!.commands.find((c) => c.name() === "inspect");
    expect(inspect).toBeDefined();
    expect(inspect!.description()).toContain("Print metadata");
  });

  it("describes the shared exit-code contract in the envelope help", () => {
    const program = new Command();
    registerEnvelopeCommand(program, { runner: fakeRunner });
    const envelopeCmd = program.commands.find((c) => c.name() === "envelope")!;
    expect(envelopeCmd.description()).toContain("0  success");
    expect(envelopeCmd.description()).toContain("1  generic error");
    expect(envelopeCmd.description()).toContain("2  ciphertext hash mismatch");
  });
});
