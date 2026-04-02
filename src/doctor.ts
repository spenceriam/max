import { existsSync, readFileSync } from "fs";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { CopilotClient } from "@github/copilot-sdk";
import { API_TOKEN_PATH, DAEMON_LOCK_PATH, DB_PATH, ENV_PATH, MAX_HOME } from "./paths.js";
import { checkForUpdate } from "./update.js";
import { listSkills } from "./copilot/skills.js";
import { getDb } from "./store/db.js";
import { runCommand } from "./autostart/helpers.js";

export type CheckLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  level: CheckLevel;
  label: string;
  detail: string;
}

export interface DoctorReport {
  generatedAt: string;
  apiPort: number;
  checks: DoctorCheck[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
}

export async function handleDoctorCommand(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const report = await runDoctor();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorReport(report);
  }

  if (report.summary.fail > 0) {
    process.exitCode = 1;
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const env = loadEnvFile();
  const apiPort = parseApiPort(env.API_PORT) ?? 7777;
  const checks = await Promise.all([
    checkMaxHome(),
    checkConfigFile(env),
    checkApiToken(),
    checkCopilotCli(),
    checkCopilotAuth(),
    checkInternetReachability(),
    checkAgentBrowser(),
    checkDaemonStatus(apiPort),
    checkAutostart(env),
    checkSkills(),
    checkWorkerSessions(),
    checkUpdateStatus(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    apiPort,
    checks,
    summary: {
      ok: checks.filter((check) => check.level === "ok").length,
      warn: checks.filter((check) => check.level === "warn").length,
      fail: checks.filter((check) => check.level === "fail").length,
    },
  };
}

export function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    console.log(`${iconFor(check.level)} ${check.label} — ${check.detail}`);
  }

  console.log(
    `\nDoctor summary: ${report.summary.ok} ok, ${report.summary.warn} warning${report.summary.warn === 1 ? "" : "s"}, ${report.summary.fail} failure${report.summary.fail === 1 ? "" : "s"}.`
  );
}

async function checkMaxHome(): Promise<DoctorCheck> {
  if (!existsSync(MAX_HOME)) {
    return {
      level: "warn",
      label: "Max home",
      detail: `Missing ${MAX_HOME}. Run 'max setup' first.`,
    };
  }

  return {
    level: "ok",
    label: "Max home",
    detail: `Using ${MAX_HOME}.`,
  };
}

async function checkConfigFile(env: Record<string, string>): Promise<DoctorCheck> {
  if (!existsSync(ENV_PATH)) {
    return {
      level: "warn",
      label: "Configuration",
      detail: `No config file at ${ENV_PATH}. Run 'max setup'.`,
    };
  }

  const issues: string[] = [];
  if (!env.COPILOT_MODEL) issues.push("missing COPILOT_MODEL");
  if (env.API_PORT && parseApiPort(env.API_PORT) === null) issues.push("invalid API_PORT");
  if (env.TELEGRAM_BOT_TOKEN && !isPositiveInt(env.AUTHORIZED_USER_ID)) {
    issues.push("TELEGRAM_BOT_TOKEN is set but AUTHORIZED_USER_ID is missing");
  }
  if (!env.TELEGRAM_BOT_TOKEN && env.AUTHORIZED_USER_ID) {
    issues.push("AUTHORIZED_USER_ID is set but TELEGRAM_BOT_TOKEN is missing");
  }

  if (issues.length > 0) {
    return {
      level: "warn",
      label: "Configuration",
      detail: issues.join("; "),
    };
  }

  return {
    level: "ok",
    label: "Configuration",
    detail: `Config loaded from ${ENV_PATH}.`,
  };
}

async function checkApiToken(): Promise<DoctorCheck> {
  if (!existsSync(API_TOKEN_PATH)) {
    return {
      level: "warn",
      label: "API token",
      detail: `No token at ${API_TOKEN_PATH}. Start Max once to generate it.`,
    };
  }

  const token = readFileSync(API_TOKEN_PATH, "utf-8").trim();
  if (!token) {
    return {
      level: "fail",
      label: "API token",
      detail: `${API_TOKEN_PATH} is empty.`,
    };
  }

  return {
    level: "ok",
    label: "API token",
    detail: `Token file present (${token.length} chars).`,
  };
}

async function checkCopilotCli(): Promise<DoctorCheck> {
  try {
    const { stdout } = await runCommand("copilot", ["--version"], 10_000);
    return {
      level: "ok",
      label: "Copilot CLI",
      detail: stdout || "copilot --version succeeded.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      level: "fail",
      label: "Copilot CLI",
      detail: `Could not run 'copilot --version': ${message}`,
    };
  }
}

async function checkCopilotAuth(): Promise<DoctorCheck> {
  let client: CopilotClient | undefined;

  try {
    client = new CopilotClient({ autoStart: true });
    await withTimeout(client.start(), 15_000, "Timed out starting the Copilot SDK client.");
    const models = await withTimeout(client.listModels(), 15_000, "Timed out fetching Copilot models.");
    const enabledModels = models.filter((model) => model.policy?.state === "enabled");

    if (enabledModels.length === 0) {
      return {
        level: "fail",
        label: "Copilot auth",
        detail: "Copilot SDK started, but no enabled models were returned. Run 'copilot login'.",
      };
    }

    return {
      level: "ok",
      label: "Copilot auth",
      detail: `${enabledModels.length} enabled model${enabledModels.length === 1 ? "" : "s"} available.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      level: "fail",
      label: "Copilot auth",
      detail: `Could not list Copilot models. Run 'copilot login'. ${message}`,
    };
  } finally {
    try {
      const stopPromise: Promise<void> = client ? client.stop().then(() => undefined) : Promise.resolve();
      await withTimeout(stopPromise, 5_000, "Timed out stopping Copilot SDK client.");
    } catch {
      // best effort
    }
  }
}

async function checkInternetReachability(): Promise<DoctorCheck> {
  const reachable = await requestHttps("api.github.com", "/meta");
  if (reachable.ok) {
    return {
      level: "ok",
      label: "Network",
      detail: "api.github.com is reachable.",
    };
  }

  return {
    level: "warn",
    label: "Network",
    detail: `Could not reach api.github.com: ${reachable.detail}`,
  };
}

async function checkAgentBrowser(): Promise<DoctorCheck> {
  try {
    const { stdout } = await runCommand("agent-browser", ["--version"], 10_000);
    if (process.platform === "linux") {
      return {
        level: "warn",
        label: "agent-browser",
        detail: `${stdout}. On many VPS/container Linux hosts, launch Chrome with --args "--no-sandbox".`,
      };
    }

    return {
      level: "ok",
      label: "agent-browser",
      detail: stdout || "agent-browser is installed.",
    };
  } catch {
    return {
      level: "warn",
      label: "agent-browser",
      detail: "agent-browser is not installed. Install with 'npm install -g agent-browser' and run 'agent-browser install'.",
    };
  }
}

async function checkDaemonStatus(apiPort: number): Promise<DoctorCheck> {
  const daemonStatus = await requestStatus(apiPort);
  if (daemonStatus.ok) {
    return {
      level: "ok",
      label: "Daemon",
      detail: `HTTP API reachable on 127.0.0.1:${apiPort}. ${daemonStatus.detail}`,
    };
  }

  if (existsSync(DAEMON_LOCK_PATH)) {
    return {
      level: "warn",
      label: "Daemon",
      detail: `Lock file exists at ${DAEMON_LOCK_PATH}, but /status is unavailable: ${daemonStatus.detail}`,
    };
  }

  return {
    level: "warn",
    label: "Daemon",
    detail: `Daemon is not responding on 127.0.0.1:${apiPort}. ${daemonStatus.detail}`,
  };
}

async function checkAutostart(env: Record<string, string>): Promise<DoctorCheck> {
  const status = await getAutostartStatusWithoutConfig();
  return {
    level: status.supported ? (status.enabled ? "ok" : "warn") : "warn",
    label: "Autostart",
    detail: `${status.summary} Recorded preference: ${env.AUTOSTART_ENABLED === "1" ? env.AUTOSTART_MODE ?? "manual" : "manual"}.`,
  };
}

async function checkSkills(): Promise<DoctorCheck> {
  const skills = listSkills();
  if (skills.length === 0) {
    return {
      level: "warn",
      label: "Skills",
      detail: "No skills found.",
    };
  }

  const unreadable = skills.filter((skill) => skill.description === "(could not read SKILL.md)");
  if (unreadable.length > 0) {
    return {
      level: "warn",
      label: "Skills",
      detail: `${skills.length} skills found, but ${unreadable.length} could not be read cleanly.`,
    };
  }

  return {
    level: "ok",
    label: "Skills",
    detail: `${skills.length} skills available.`,
  };
}

async function checkWorkerSessions(): Promise<DoctorCheck> {
  if (!existsSync(DB_PATH)) {
    return {
      level: "warn",
      label: "Worker sessions",
      detail: `No database at ${DB_PATH} yet.`,
    };
  }

  const db = getDb();
  const rows = db.prepare(
    "SELECT status, COUNT(*) as count FROM worker_sessions GROUP BY status"
  ).all() as { status: string; count: number }[];

  const summary = rows.length === 0
    ? "No worker sessions recorded."
    : rows.map((row) => `${row.count} ${row.status}`).join(", ");

  return {
    level: "ok",
    label: "Worker sessions",
    detail: summary,
  };
}

async function checkUpdateStatus(): Promise<DoctorCheck> {
  const status = await checkForUpdate();
  if (!status.checkSucceeded) {
    return {
      level: "warn",
      label: "Updates",
      detail: "Could not reach the npm registry.",
    };
  }

  if (!status.updateAvailable) {
    return {
      level: "ok",
      label: "Updates",
      detail: `Installed version ${status.current} is current.`,
    };
  }

  return {
    level: "warn",
    label: "Updates",
    detail: `Update available: ${status.current} -> ${status.latest}. Run 'max update'.`,
  };
}

async function requestStatus(apiPort: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: apiPort,
        path: "/status",
        method: "GET",
        timeout: 3_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve({
              ok: false,
              detail: `Unexpected status code ${res.statusCode ?? "unknown"}.`,
            });
            return;
          }

          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
              workers?: unknown[];
            };
            const workerCount = Array.isArray(payload.workers) ? payload.workers.length : 0;
            resolve({
              ok: true,
              detail: `${workerCount} active worker${workerCount === 1 ? "" : "s"}.`,
            });
          } catch {
            resolve({
              ok: false,
              detail: "Daemon responded with invalid JSON.",
            });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "Request timed out." });
    });
    req.on("error", (error) => {
      resolve({ ok: false, detail: error.message });
    });
    req.end();
  });
}

async function requestHttps(hostname: string, path: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        hostname,
        path,
        method: "GET",
        timeout: 5_000,
        headers: {
          "User-Agent": "max-doctor",
          Accept: "application/json",
        },
      },
      (res) => {
        resolve({
          ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode < 400,
          detail: `HTTP ${res.statusCode ?? "unknown"}`,
        });
        res.resume();
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "Request timed out." });
    });
    req.on("error", (error) => {
      resolve({ ok: false, detail: error.message });
    });
    req.end();
  });
}

function loadEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};

  return readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reduce<Record<string, string>>((acc, line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) acc[match[1]] = match[2];
      return acc;
    }, {});
}

function parseApiPort(value: string | undefined): number | null {
  const parsed = Number(value ?? "7777");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function isPositiveInt(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

async function getAutostartStatusWithoutConfig(): Promise<{
  supported: boolean;
  enabled: boolean;
  summary: string;
}> {
  switch (process.platform) {
    case "linux": {
      const { getSystemdAutostartStatus } = await import("./autostart/systemd.js");
      const status = await getSystemdAutostartStatus();
      return { supported: status.supported, enabled: status.enabled, summary: status.summary };
    }
    case "win32": {
      const { getWindowsAutostartStatus } = await import("./autostart/windows.js");
      const status = await getWindowsAutostartStatus();
      return { supported: status.supported, enabled: status.enabled, summary: status.summary };
    }
    default:
      return {
        supported: false,
        enabled: false,
        summary: `Autostart is not supported on ${process.platform} yet.`,
      };
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function iconFor(level: CheckLevel): string {
  switch (level) {
    case "ok":
      return "✓";
    case "warn":
      return "⚠";
    case "fail":
      return "✗";
  }
}
