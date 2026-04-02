import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import {
  SYSTEMD_SERVICE_PATH,
  SYSTEMD_USER_DIR,
} from "../paths.js";
import {
  getCommandErrorMessage,
  quoteForSystemd,
  runCommand,
} from "./helpers.js";
import type {
  AutostartActionResult,
  AutostartStatus,
  LaunchCommand,
} from "./types.js";

const SYSTEMD_UNIT_NAME = "max.service";

export async function getSystemdAutostartStatus(): Promise<AutostartStatus> {
  try {
    await assertSystemdUserAvailable();
  } catch (error) {
    return {
      supported: false,
      enabled: false,
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: `systemd user services are unavailable: ${getCommandErrorMessage(error)}`,
      details: [`Expected service file: ${SYSTEMD_SERVICE_PATH}`],
    };
  }

  if (!existsSync(SYSTEMD_SERVICE_PATH)) {
    return {
      supported: true,
      enabled: false,
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: "Autostart is disabled.",
      details: [`Service file not found: ${SYSTEMD_SERVICE_PATH}`],
    };
  }

  try {
    const { stdout } = await runCommand("systemctl", [
      "--user",
      "show",
      SYSTEMD_UNIT_NAME,
      "--property=LoadState,UnitFileState,ActiveState,SubState",
    ]);
    const state = parseShowOutput(stdout);
    const enabled = state.UnitFileState === "enabled";

    return {
      supported: true,
      enabled,
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: enabled
        ? "Autostart is enabled via a systemd user service."
        : "Autostart service exists, but it is not enabled.",
      details: [
        `Service file: ${SYSTEMD_SERVICE_PATH}`,
        `LoadState: ${state.LoadState ?? "unknown"}`,
        `UnitFileState: ${state.UnitFileState ?? "unknown"}`,
        `ActiveState: ${state.ActiveState ?? "unknown"}`,
        `SubState: ${state.SubState ?? "unknown"}`,
      ],
    };
  } catch (error) {
    return {
      supported: true,
      enabled: false,
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: `Autostart service exists, but Max could not query systemd: ${getCommandErrorMessage(error)}`,
      details: [`Service file: ${SYSTEMD_SERVICE_PATH}`],
    };
  }
}

export async function enableSystemdAutostart(
  launch: LaunchCommand,
  dryRun = false
): Promise<AutostartActionResult> {
  const execStart = [launch.executable, ...launch.args].map(quoteForSystemd).join(" ");
  const serviceFile = buildServiceFile(execStart);

  if (dryRun) {
    return {
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: "Would register Max with a systemd user service.",
      details: [
        `Service file: ${SYSTEMD_SERVICE_PATH}`,
        `ExecStart: ${launch.display}`,
      ],
      dryRun: true,
    };
  }

  await assertSystemdUserAvailable();

  mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
  writeFileSync(SYSTEMD_SERVICE_PATH, serviceFile, { mode: 0o644 });

  try {
    await runCommand("systemctl", ["--user", "daemon-reload"]);
    await runCommand("systemctl", ["--user", "enable", SYSTEMD_UNIT_NAME]);
  } catch (error) {
    throw new Error(
      `Could not enable the Max systemd service: ${getCommandErrorMessage(error)}`
    );
  }

  return {
    mode: "systemd",
    artifactPath: SYSTEMD_SERVICE_PATH,
    summary: "Autostart enabled via systemd user service.",
    details: [
      `Service file: ${SYSTEMD_SERVICE_PATH}`,
      `ExecStart: ${launch.display}`,
      "Max will start automatically on your next login.",
    ],
    dryRun: false,
  };
}

export async function disableSystemdAutostart(
  dryRun = false
): Promise<AutostartActionResult> {
  if (dryRun) {
    return {
      mode: "systemd",
      artifactPath: SYSTEMD_SERVICE_PATH,
      summary: "Would disable the Max systemd user service.",
      details: [`Service file: ${SYSTEMD_SERVICE_PATH}`],
      dryRun: true,
    };
  }

  await assertSystemdUserAvailable();

  try {
    await runCommand("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
  } catch (error) {
    const message = getCommandErrorMessage(error);
    const missingUnit =
      message.includes("not loaded") ||
      message.includes("No such file") ||
      message.includes("not found");

    if (!missingUnit) {
      throw new Error(
        `Could not disable the Max systemd service: ${message}`
      );
    }
  }

  if (existsSync(SYSTEMD_SERVICE_PATH)) {
    rmSync(SYSTEMD_SERVICE_PATH);
  }

  try {
    await runCommand("systemctl", ["--user", "daemon-reload"]);
  } catch (error) {
    throw new Error(
      `Could not reload the systemd user manager after disabling Max: ${getCommandErrorMessage(error)}`
    );
  }

  return {
    mode: "systemd",
    artifactPath: SYSTEMD_SERVICE_PATH,
    summary: "Autostart disabled for the systemd user service.",
    details: [`Service file removed: ${SYSTEMD_SERVICE_PATH}`],
    dryRun: false,
  };
}

async function assertSystemdUserAvailable(): Promise<void> {
  try {
    await runCommand("systemctl", ["--user", "show-environment"], 5_000);
  } catch (error) {
    throw new Error(getCommandErrorMessage(error));
  }
}

function buildServiceFile(execStart: string): string {
  return [
    "[Unit]",
    "Description=Max AI orchestrator daemon",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h",
    "Environment=HOME=%h",
    `ExecStart=${execStart}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function parseShowOutput(stdout: string): Record<string, string> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const [key, ...rest] = line.split("=");
      acc[key] = rest.join("=");
      return acc;
    }, {});
}
