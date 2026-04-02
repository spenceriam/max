import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  API_TOKEN_PATH,
  DAEMON_LOCK_PATH,
  DB_PATH,
  ensureMaxHome,
  ENV_PATH,
  MAX_HOME,
  SESSIONS_DIR,
  SKILLS_DIR,
} from "./paths.js";

const READABLE_KEYS = new Set([
  "TELEGRAM_BOT_TOKEN",
  "AUTHORIZED_USER_ID",
  "API_PORT",
  "COPILOT_MODEL",
  "WORKER_TIMEOUT",
  "AUTOSTART_ENABLED",
  "AUTOSTART_MODE",
]);
const MUTABLE_KEYS = new Set([
  "TELEGRAM_BOT_TOKEN",
  "AUTHORIZED_USER_ID",
  "API_PORT",
  "COPILOT_MODEL",
  "WORKER_TIMEOUT",
]);

export async function handleConfigCommand(args: string[]): Promise<void> {
  const [subcommand = "show", ...rest] = args;

  switch (subcommand) {
    case "show":
      printConfig();
      return;
    case "get":
      printConfigValue(rest[0]);
      return;
    case "set":
      setConfigValue(rest[0], rest.slice(1));
      return;
    case "show-token":
      showToken();
      return;
    case "paths":
      showPaths();
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown config command: ${subcommand}\n\n${getHelpText()}`);
  }
}

function printConfig(): void {
  const values = loadEnvFile();
  const orderedKeys = [
    "TELEGRAM_BOT_TOKEN",
    "AUTHORIZED_USER_ID",
    "API_PORT",
    "COPILOT_MODEL",
    "WORKER_TIMEOUT",
    "AUTOSTART_ENABLED",
    "AUTOSTART_MODE",
  ];

  for (const key of orderedKeys) {
    const raw = values[key];
    if (raw === undefined) continue;
    console.log(`${key}=${maskIfSensitive(key, raw)}`);
  }
}

function printConfigValue(key: string | undefined): void {
  if (!key) {
    throw new Error(`Usage: max config get <KEY>`);
  }

  assertReadableKey(key);
  const values = loadEnvFile();
  if (!(key in values)) {
    throw new Error(`${key} is not set in ${ENV_PATH}.`);
  }

  console.log(maskIfSensitive(key, values[key]));
}

function setConfigValue(key: string | undefined, valueParts: string[]): void {
  if (!key || valueParts.length === 0) {
    throw new Error(`Usage: max config set <KEY> <VALUE>`);
  }

  assertMutableKey(key);
  const value = valueParts.join(" ");
  validateValue(key, value);
  persistEnvValue(key, value);

  console.log(`Updated ${key}=${maskIfSensitive(key, value)}`);
}

function showToken(): void {
  if (!existsSync(API_TOKEN_PATH)) {
    throw new Error(`No API token exists yet at ${API_TOKEN_PATH}. Start Max once to generate it.`);
  }

  console.log(readFileSync(API_TOKEN_PATH, "utf-8").trim());
}

function showPaths(): void {
  const entries = [
    ["MAX_HOME", MAX_HOME],
    ["ENV_PATH", ENV_PATH],
    ["DB_PATH", DB_PATH],
    ["API_TOKEN_PATH", API_TOKEN_PATH],
    ["DAEMON_LOCK_PATH", DAEMON_LOCK_PATH],
    ["SESSIONS_DIR", SESSIONS_DIR],
    ["SKILLS_DIR", SKILLS_DIR],
  ];

  for (const [label, value] of entries) {
    console.log(`${label}=${value}`);
  }
}

function loadEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};

  return readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) acc[match[1]] = match[2];
      return acc;
    }, {});
}

function validateValue(key: string, value: string): void {
  switch (key) {
    case "AUTHORIZED_USER_ID": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("AUTHORIZED_USER_ID must be a positive integer.");
      }
      return;
    }
    case "API_PORT": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error("API_PORT must be an integer between 1 and 65535.");
      }
      return;
    }
    case "WORKER_TIMEOUT": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("WORKER_TIMEOUT must be a positive integer in milliseconds.");
      }
      return;
    }
    default:
      return;
  }
}

function maskIfSensitive(key: string, value: string): string {
  if (key !== "TELEGRAM_BOT_TOKEN") return value;
  if (value.length <= 12) return `${value.slice(0, 4)}***`;
  return `${value.slice(0, 12)}***`;
}

function assertMutableKey(key: string): void {
  if (!MUTABLE_KEYS.has(key)) {
    if (key === "AUTOSTART_ENABLED" || key === "AUTOSTART_MODE") {
      throw new Error(`Use 'max autostart' to manage ${key}.`);
    }
    throw new Error(`Unsupported config key: ${key}`);
  }
}

function assertReadableKey(key: string): void {
  if (!READABLE_KEYS.has(key)) {
    throw new Error(`Unsupported config key: ${key}`);
  }
}

function persistEnvValue(key: string, value: string): void {
  ensureMaxHome();
  const values = loadEnvFile();
  values[key] = value;
  const lines = Object.entries(values).map(([entryKey, entryValue]) => `${entryKey}=${entryValue}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
}

function printHelp(): void {
  console.log(getHelpText());
}

function getHelpText(): string {
  return [
    "Usage:",
    "  max config",
    "  max config show",
    "  max config get <KEY>",
    "  max config set <KEY> <VALUE>",
    "  max config show-token",
    "  max config paths",
    "",
    "Readable keys:",
    "  TELEGRAM_BOT_TOKEN",
    "  AUTHORIZED_USER_ID",
    "  API_PORT",
    "  COPILOT_MODEL",
    "  WORKER_TIMEOUT",
    "  AUTOSTART_ENABLED",
    "  AUTOSTART_MODE",
    "",
    "Autostart settings are shown in the config file,",
    "but should be managed with: max autostart",
  ].join("\n");
}
