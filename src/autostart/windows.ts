import {
  getCommandErrorMessage,
  quoteForPowerShellLiteral,
  quoteWindowsCommandArg,
  runCommand,
} from "./helpers.js";
import type {
  AutostartActionResult,
  AutostartStatus,
  LaunchCommand,
} from "./types.js";

const WINDOWS_TASK_NAME = "Max";
const WINDOWS_TASK_ARTIFACT = `Task Scheduler/${WINDOWS_TASK_NAME}`;

export async function getWindowsAutostartStatus(): Promise<AutostartStatus> {
  try {
    const { stdout } = await runPowerShell(buildStatusScript());
    const status = JSON.parse(stdout) as {
      exists: boolean;
      enabled?: boolean;
      state?: string;
      taskName?: string;
    };

    if (!status.exists) {
      return {
        supported: true,
        enabled: false,
        mode: "windows-task",
        artifactPath: WINDOWS_TASK_ARTIFACT,
        summary: "Autostart is disabled.",
        details: [`Scheduled task not found: ${WINDOWS_TASK_NAME}`],
      };
    }

    const enabled = status.enabled !== false;

    return {
      supported: true,
      enabled,
      mode: "windows-task",
      artifactPath: WINDOWS_TASK_ARTIFACT,
      summary: enabled
        ? "Autostart is enabled via Windows Task Scheduler."
        : "Autostart scheduled task exists, but it is disabled.",
      details: [
        `Scheduled task: ${status.taskName ?? WINDOWS_TASK_NAME}`,
        `Task enabled: ${enabled ? "yes" : "no"}`,
        `Task state: ${status.state ?? "unknown"}`,
      ],
    };
  } catch (error) {
    return {
      supported: false,
      enabled: false,
      mode: "windows-task",
      artifactPath: WINDOWS_TASK_ARTIFACT,
      summary: `Windows Task Scheduler is unavailable: ${getCommandErrorMessage(error)}`,
      details: [`Expected task: ${WINDOWS_TASK_NAME}`],
    };
  }
}

export async function enableWindowsAutostart(
  launch: LaunchCommand,
  dryRun = false
): Promise<AutostartActionResult> {
  if (dryRun) {
    return {
      mode: "windows-task",
      artifactPath: WINDOWS_TASK_ARTIFACT,
      summary: "Would register Max with Windows Task Scheduler.",
      details: [
        `Scheduled task: ${WINDOWS_TASK_NAME}`,
        `ExecStart: ${launch.display}`,
      ],
      dryRun: true,
    };
  }

  const script = buildEnableScript(launch);

  try {
    await runPowerShell(script);
  } catch (error) {
    throw new Error(
      `Could not enable the Max scheduled task: ${getCommandErrorMessage(error)}`
    );
  }

  return {
    mode: "windows-task",
    artifactPath: WINDOWS_TASK_ARTIFACT,
    summary: "Autostart enabled via Windows Task Scheduler.",
    details: [
      `Scheduled task: ${WINDOWS_TASK_NAME}`,
      `ExecStart: ${launch.display}`,
      "Max will start automatically on your next login.",
    ],
    dryRun: false,
  };
}

export async function disableWindowsAutostart(
  dryRun = false
): Promise<AutostartActionResult> {
  if (dryRun) {
    return {
      mode: "windows-task",
      artifactPath: WINDOWS_TASK_ARTIFACT,
      summary: "Would disable the Max scheduled task.",
      details: [`Scheduled task: ${WINDOWS_TASK_NAME}`],
      dryRun: true,
    };
  }

  try {
    await runPowerShell(buildDisableScript());
  } catch (error) {
    throw new Error(
      `Could not disable the Max scheduled task: ${getCommandErrorMessage(error)}`
    );
  }

  return {
    mode: "windows-task",
    artifactPath: WINDOWS_TASK_ARTIFACT,
    summary: "Autostart disabled for Windows Task Scheduler.",
    details: [`Scheduled task removed: ${WINDOWS_TASK_NAME}`],
    dryRun: false,
  };
}

function buildEnableScript(launch: LaunchCommand): string {
  const argument = launch.args.map(quoteWindowsCommandArg).join(" ");

  return [
    `$taskName = ${quoteForPowerShellLiteral(WINDOWS_TASK_NAME)}`,
    `$taskDescription = ${quoteForPowerShellLiteral("Start Max at user logon")}`,
    `$execute = ${quoteForPowerShellLiteral(launch.executable)}`,
    `$arguments = ${quoteForPowerShellLiteral(argument)}`,
    "$action = New-ScheduledTaskAction -Execute $execute -Argument $arguments",
    "$trigger = New-ScheduledTaskTrigger -AtLogOn",
    "$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive",
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description $taskDescription -Force | Out-Null",
  ].join("; ");
}

function buildDisableScript(): string {
  return [
    `$taskName = ${quoteForPowerShellLiteral(WINDOWS_TASK_NAME)}`,
    "$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue",
    "if ($null -ne $task) {",
    "  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false",
    "}",
  ].join(" ");
}

function buildStatusScript(): string {
  return [
    `$taskName = ${quoteForPowerShellLiteral(WINDOWS_TASK_NAME)}`,
    "$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue",
    "if ($null -eq $task) {",
    "  @{ exists = $false } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "$result = @{",
    "  exists = $true",
    "  taskName = $task.TaskName",
    "  enabled = [bool]$task.Settings.Enabled",
    "  state = $task.State.ToString()",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join(" ");
}

async function runPowerShell(script: string): Promise<{ stdout: string; stderr: string }> {
  return runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    20_000
  );
}
