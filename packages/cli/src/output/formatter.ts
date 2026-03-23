import pc from "picocolors";
import * as readline from "readline";
import { SopsMissingError, SopsVersionError } from "@clef-sh/core";
import { sym, isPlainMode } from "./symbols";

function color(fn: (s: string) => string, str: string): string {
  return isPlainMode() ? str : fn(str);
}

export const formatter = {
  success(message: string): void {
    const icon = sym("success");
    process.stdout.write(color(pc.green, `${icon}  ${message}`) + "\n");
  },

  failure(message: string): void {
    const icon = sym("failure");
    process.stderr.write(color(pc.red, `${icon}  ${message}`) + "\n");
  },

  error(message: string): void {
    const icon = sym("failure");
    process.stderr.write(color(pc.red, `${icon}  Error: ${message}`) + "\n");
  },

  warn(message: string): void {
    const icon = sym("warning");
    process.stderr.write(color(pc.yellow, `${icon}  ${message}`) + "\n");
  },

  info(message: string): void {
    const icon = sym("info");
    process.stdout.write(color(pc.blue, `${icon}  ${message}`) + "\n");
  },

  hint(message: string): void {
    const icon = sym("arrow");
    process.stdout.write(`${icon}  ${message}\n`);
  },

  keyValue(key: string, value: string): void {
    const icon = sym("key");
    const arrow = sym("arrow");
    const prefix = icon ? `${icon}  ` : "";
    process.stdout.write(`${prefix}${key}  ${arrow}  ${value}\n`);
  },

  pendingItem(key: string, days: number): void {
    const icon = sym("pending");
    const prefix = icon ? `${icon}  ` : "[pending]  ";
    process.stdout.write(`${prefix}${key} \u2014 ${days} day${days !== 1 ? "s" : ""} pending\n`);
  },

  recipientItem(label: string, keyPreview: string): void {
    const icon = sym("recipient");
    const prefix = icon ? `${icon}  ` : "";
    process.stdout.write(`${prefix}${label.padEnd(15)}${keyPreview}\n`);
  },

  section(label: string): void {
    process.stdout.write(`\n${label}\n\n`);
  },

  print(message: string): void {
    process.stdout.write(message + "\n");
  },

  raw(message: string): void {
    process.stdout.write(message);
  },

  table(rows: string[][], columns: string[]): void {
    const widths = columns.map((col, i) => {
      const maxDataWidth = rows.reduce(
        (max, row) => Math.max(max, stripAnsi(row[i] ?? "").length),
        0,
      );
      return Math.max(stripAnsi(col).length, maxDataWidth);
    });

    const header = columns
      .map((col, i) => (isPlainMode() ? pad(col, widths[i]) : pc.bold(pad(col, widths[i]))))
      .join("  ");
    process.stdout.write(header + "\n");
    process.stdout.write(widths.map((w) => "\u2500".repeat(w)).join("  ") + "\n");

    for (const row of rows) {
      const line = row.map((cell, i) => pad(cell, widths[i])).join("  ");
      process.stdout.write(line + "\n");
    }
  },

  async confirm(prompt: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    return new Promise((resolve) => {
      rl.question(color(pc.yellow, `${prompt} [y/N] `), (answer) => {
        rl.close();
        process.stdin.pause();
        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
      });
    });
  },

  formatDependencyError(err: SopsMissingError | SopsVersionError): void {
    const icon = sym("failure");
    const arrow = sym("arrow");
    const name = "sops";

    if (err instanceof SopsMissingError) {
      process.stderr.write(color(pc.red, `${icon}  ${name} is not installed.`) + "\n");
      process.stderr.write(`  ${arrow}  Install: ${err.installHint}\n`);
    } else {
      process.stderr.write(
        color(
          pc.red,
          `${icon}  ${name} v${err.installed} found but v${err.required}+ is required.`,
        ) + "\n",
      );
      process.stderr.write(`  ${arrow}  Upgrade: ${err.installHint}\n`);
    }
    process.stderr.write(`  ${arrow}  Then run clef doctor to verify.\n`);
  },

  async secretPrompt(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      process.stderr.write(color(pc.cyan, `${prompt}: `));

      // Enable raw mode to suppress echo on TTY terminals
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }

      let value = "";
      const onData = (chunk: Buffer) => {
        const char = chunk.toString();
        if (char === "\n" || char === "\r" || char === "\u0004") {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          process.stderr.write("\n");
          resolve(value);
        } else if (char === "\u0003") {
          // Ctrl+C
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.removeListener("data", onData);
          reject(new Error("User cancelled input"));
        } else if (char === "\u007f" || char === "\b") {
          // Backspace
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      };

      process.stdin.on("data", onData);
    });
  },
};

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences for width calculation
  return str.replace(/\u001B\[[0-9;]*m/g, "");
}

function pad(str: string, width: number): string {
  const visible = stripAnsi(str);
  const diff = width - visible.length;
  return diff > 0 ? str + " ".repeat(diff) : str;
}
