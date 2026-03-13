import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { ENV_PATH, ensureMaxHome } from "./paths.js";

// Load from ~/.max/.env, fall back to cwd .env for dev
loadEnv({ path: ENV_PATH });
loadEnv(); // also check cwd for backwards compat

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  AUTHORIZED_USER_ID: z.string().min(1).optional(),
  API_PORT: z.string().optional(),
  COPILOT_MODEL: z.string().optional(),
  WORKER_TIMEOUT: z.string().optional(),
  ROUTER_ENABLED: z.string().optional(),
  ROUTER_FAST_MODEL: z.string().optional(),
  ROUTER_STANDARD_MODEL: z.string().optional(),
  ROUTER_PREMIUM_MODEL: z.string().optional(),
});

const raw = configSchema.parse(process.env);

const parsedUserId = raw.AUTHORIZED_USER_ID
  ? parseInt(raw.AUTHORIZED_USER_ID, 10)
  : undefined;
const parsedPort = parseInt(raw.API_PORT || "7777", 10);

if (parsedUserId !== undefined && (Number.isNaN(parsedUserId) || parsedUserId <= 0)) {
  throw new Error(`AUTHORIZED_USER_ID must be a positive integer, got: "${raw.AUTHORIZED_USER_ID}"`);
}
if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
  throw new Error(`API_PORT must be 1-65535, got: "${raw.API_PORT}"`);
}

const DEFAULT_WORKER_TIMEOUT_MS = 600_000; // 10 minutes
const parsedWorkerTimeout = raw.WORKER_TIMEOUT
  ? Number(raw.WORKER_TIMEOUT)
  : DEFAULT_WORKER_TIMEOUT_MS;

if (!Number.isInteger(parsedWorkerTimeout) || parsedWorkerTimeout <= 0) {
  throw new Error(`WORKER_TIMEOUT must be a positive integer (ms), got: "${raw.WORKER_TIMEOUT}"`);
}

export const DEFAULT_MODEL = "claude-sonnet-4.6";

let _copilotModel = raw.COPILOT_MODEL || DEFAULT_MODEL;
let _routerEnabled = raw.ROUTER_ENABLED !== undefined ? raw.ROUTER_ENABLED === "true" : true;
let _routerFastModel = raw.ROUTER_FAST_MODEL || "gpt-4.1";
let _routerStandardModel = raw.ROUTER_STANDARD_MODEL || "claude-sonnet-4.6";
let _routerPremiumModel = raw.ROUTER_PREMIUM_MODEL || "claude-opus-4.6";

export const config = {
  telegramBotToken: raw.TELEGRAM_BOT_TOKEN,
  authorizedUserId: parsedUserId,
  apiPort: parsedPort,
  workerTimeoutMs: parsedWorkerTimeout,
  get copilotModel(): string {
    return _copilotModel;
  },
  set copilotModel(model: string) {
    _copilotModel = model;
  },
  get telegramEnabled(): boolean {
    return !!this.telegramBotToken && this.authorizedUserId !== undefined;
  },
  get routerEnabled(): boolean {
    return _routerEnabled;
  },
  set routerEnabled(enabled: boolean) {
    _routerEnabled = enabled;
  },
  get routerFastModel(): string {
    return _routerFastModel;
  },
  set routerFastModel(model: string) {
    _routerFastModel = model;
  },
  get routerStandardModel(): string {
    return _routerStandardModel;
  },
  set routerStandardModel(model: string) {
    _routerStandardModel = model;
  },
  get routerPremiumModel(): string {
    return _routerPremiumModel;
  },
  set routerPremiumModel(model: string) {
    _routerPremiumModel = model;
  },
  get selfEditEnabled(): boolean {
    return process.env.MAX_SELF_EDIT === "1";
  },
};

/** Update or append an env var in ~/.max/.env */
function persistEnvVar(key: string, value: string): void {
  ensureMaxHome();
  try {
    const content = readFileSync(ENV_PATH, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    writeFileSync(ENV_PATH, updated.join("\n"));
  } catch {
    // File doesn't exist — create it
    writeFileSync(ENV_PATH, `${key}=${value}\n`);
  }
}

/** Persist the current model choice to ~/.max/.env */
export function persistModel(model: string): void {
  persistEnvVar("COPILOT_MODEL", model);
}

/** Persist all router-related config to ~/.max/.env */
export function persistRouterConfig(): void {
  persistEnvVar("ROUTER_ENABLED", String(config.routerEnabled));
  persistEnvVar("ROUTER_FAST_MODEL", config.routerFastModel);
  persistEnvVar("ROUTER_STANDARD_MODEL", config.routerStandardModel);
  persistEnvVar("ROUTER_PREMIUM_MODEL", config.routerPremiumModel);
}
