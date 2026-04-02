import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function runCommand(
  file: string,
  args: string[],
  timeoutMs = 15_000
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function getCommandErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const maybeIoError = error as Error & { stderr?: string; stdout?: string };
    const stderr = maybeIoError.stderr?.trim();
    if (stderr) return stderr;
    const stdout = maybeIoError.stdout?.trim();
    if (stdout) return stdout;
    return error.message;
  }

  return String(error);
}

export function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteForDisplay).join(" ");
}

export function quoteForSystemd(arg: string): string {
  return `"${arg
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%")}"`;
}

export function quoteForPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteWindowsCommandArg(arg: string): string {
  if (!/[\s"]/u.test(arg)) return arg;

  let result = '"';
  let backslashes = 0;

  for (const char of arg) {
    if (char === "\\") {
      backslashes++;
      continue;
    }

    if (char === '"') {
      result += "\\".repeat(backslashes * 2 + 1);
      result += char;
      backslashes = 0;
      continue;
    }

    result += "\\".repeat(backslashes);
    result += char;
    backslashes = 0;
  }

  result += "\\".repeat(backslashes * 2);
  result += '"';
  return result;
}

function quoteForDisplay(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(arg)) return arg;
  return JSON.stringify(arg);
}
