import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { config, persistAutostart } from "../config.js";
import { formatCommand } from "./helpers.js";
import { disableSystemdAutostart, enableSystemdAutostart, getSystemdAutostartStatus } from "./systemd.js";
import { disableWindowsAutostart, enableWindowsAutostart, getWindowsAutostartStatus } from "./windows.js";
import type {
  AutostartActionResult,
  AutostartMode,
  AutostartStatus,
  LaunchCommand,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getSupportedAutostartMode(): AutostartMode | null {
  switch (process.platform) {
    case "linux":
      return "systemd";
    case "win32":
      return "windows-task";
    default:
      return null;
  }
}

export function describeAutostartMode(mode: AutostartMode): string {
  switch (mode) {
    case "systemd":
      return "systemd user service";
    case "windows-task":
      return "Windows Task Scheduler";
  }
}

export function resolveDaemonLaunchCommand(): LaunchCommand {
  const cliPath = resolve(__dirname, "..", "cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(
      `Could not locate the Max CLI entrypoint at ${cliPath}. Run 'npm run build' or reinstall Max.`
    );
  }

  const args = [cliPath, "start"];
  return {
    executable: process.execPath,
    args,
    display: formatCommand(process.execPath, args),
  };
}

export async function enableAutostart(options: {
  dryRun?: boolean;
} = {}): Promise<AutostartActionResult> {
  const mode = getSupportedAutostartMode();
  if (!mode) {
    throw new Error(
      `Autostart is not supported on ${process.platform} yet.`
    );
  }

  const launch = resolveDaemonLaunchCommand();
  const result = await runEnable(mode, launch, options.dryRun ?? false);

  if (!result.dryRun) {
    persistAutostart(true, mode);
  }

  return result;
}

export async function disableAutostart(options: {
  dryRun?: boolean;
} = {}): Promise<AutostartActionResult> {
  const mode = getSupportedAutostartMode();
  if (!mode) {
    throw new Error(
      `Autostart is not supported on ${process.platform} yet.`
    );
  }

  const result = await runDisable(mode, options.dryRun ?? false);

  if (!result.dryRun) {
    persistAutostart(false, "manual");
  }

  return result;
}

export async function getAutostartStatus(): Promise<AutostartStatus> {
  const mode = getSupportedAutostartMode();
  if (!mode) {
    return {
      supported: false,
      enabled: false,
      mode: null,
      summary: `Autostart is not supported on ${process.platform} yet.`,
      details: [
        `Recorded preference: ${config.autostartEnabled ? config.autostartMode : "manual"}`,
      ],
    };
  }

  const status = await runStatus(mode);
  return {
    ...status,
    details: [
      ...status.details,
      `Recorded preference: ${config.autostartEnabled ? config.autostartMode : "manual"}`,
    ],
  };
}

export async function handleAutostartCommand(args: string[]): Promise<void> {
  const filteredArgs = args.filter((arg) => arg !== "--dry-run");
  const dryRun = args.includes("--dry-run");
  const subcommand = filteredArgs[0] ?? "status";

  switch (subcommand) {
    case "enable": {
      const result = await enableAutostart({ dryRun });
      printResult(result);
      return;
    }
    case "disable": {
      const result = await disableAutostart({ dryRun });
      printResult(result);
      return;
    }
    case "status": {
      const status = await getAutostartStatus();
      printStatus(status);
      return;
    }
    case "help":
    case "--help":
    case "-h":
      printAutostartHelp();
      return;
    default:
      throw new Error(
        `Unknown autostart command: ${subcommand}\n\n${getAutostartHelpText()}`
      );
  }
}

function runEnable(
  mode: AutostartMode,
  launch: LaunchCommand,
  dryRun: boolean
): Promise<AutostartActionResult> {
  switch (mode) {
    case "systemd":
      return enableSystemdAutostart(launch, dryRun);
    case "windows-task":
      return enableWindowsAutostart(launch, dryRun);
  }
}

function runDisable(
  mode: AutostartMode,
  dryRun: boolean
): Promise<AutostartActionResult> {
  switch (mode) {
    case "systemd":
      return disableSystemdAutostart(dryRun);
    case "windows-task":
      return disableWindowsAutostart(dryRun);
  }
}

function runStatus(mode: AutostartMode): Promise<AutostartStatus> {
  switch (mode) {
    case "systemd":
      return getSystemdAutostartStatus();
    case "windows-task":
      return getWindowsAutostartStatus();
  }
}

function printResult(result: AutostartActionResult): void {
  console.log(result.summary);
  for (const detail of result.details) {
    console.log(`- ${detail}`);
  }
}

function printStatus(status: AutostartStatus): void {
  console.log(status.summary);
  for (const detail of status.details) {
    console.log(`- ${detail}`);
  }
}

function printAutostartHelp(): void {
  console.log(getAutostartHelpText());
}

function getAutostartHelpText(): string {
  return [
    "Usage:",
    "  max autostart [status]",
    "  max autostart enable [--dry-run]",
    "  max autostart disable [--dry-run]",
    "",
    "Examples:",
    "  max autostart status",
    "  max autostart enable",
    "  max autostart disable --dry-run",
  ].join("\n");
}
