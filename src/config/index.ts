import { resolve } from "node:path";
import type { Role } from "../shared/types.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ROLE_VALUES = new Set<Role>(["viewer", "operator", "admin"]);

export interface AppConfig {
  environment: "development" | "test" | "production";
  dataDirectory: string;
  businessDatabasePath: string;
  piDatabasePath: string;
  health: {
    host: string;
    port: number;
  };
  tools: {
    wifiInterface: string;
    commandTimeoutMs: number;
    maximumOutputBytes: number;
    maximumConcurrentCommands: number;
  };
  lark: {
    enabled: boolean;
    appId?: string;
    appSecret?: string;
    userRoles: ReadonlyMap<string, Role>;
    allowedChatIds: ReadonlySet<string>;
  };
  model: {
    enabled: boolean;
    provider?: "openai" | "anthropic";
    modelId?: string;
    apiKey?: string;
    timeoutMs: number;
  };
  service: {
    maximumConcurrentRequests: number;
    maximumQueuedRequests: number;
    maximumMessageCharacters: number;
  };
}

export class ConfigurationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
  }
}

function booleanValue(value: string | undefined, fallback: boolean, name: string, issues: string[]): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push(`${name} must be true or false`);
  return fallback;
}

function integerValue(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
  issues: string[],
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(`${name} must be an integer between ${minimum} and ${maximum}`);
    return fallback;
  }
  return parsed;
}

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function identifierSet(value: string | undefined, name: string, issues: string[]): Set<string> {
  const output = new Set<string>();
  for (const candidate of value?.split(",") ?? []) {
    const identifier = candidate.trim();
    if (!identifier) continue;
    if (!IDENTIFIER_PATTERN.test(identifier)) issues.push(`${name} contains an invalid identifier`);
    else output.add(identifier);
  }
  return output;
}

function roleMap(value: string | undefined, issues: string[]): Map<string, Role> {
  const output = new Map<string, Role>();
  for (const assignment of value?.split(",") ?? []) {
    const entry = assignment.trim();
    if (!entry) continue;
    const separator = entry.lastIndexOf(":");
    const identifier = entry.slice(0, separator);
    const role = entry.slice(separator + 1) as Role;
    if (separator < 1 || !IDENTIFIER_PATTERN.test(identifier) || !ROLE_VALUES.has(role)) {
      issues.push("WAYFINDER_USER_ROLES must use open_id:viewer|operator|admin entries");
      continue;
    }
    if (output.has(identifier)) issues.push("WAYFINDER_USER_ROLES contains a duplicate open_id");
    output.set(identifier, role);
  }
  return output;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const issues: string[] = [];
  const mode = environment.NODE_ENV ?? "development";
  if (!(["development", "test", "production"] as string[]).includes(mode)) {
    issues.push("NODE_ENV must be development, test, or production");
  }

  const dataDirectory = resolve(environment.WAYFINDER_DATA_DIR?.trim() || "./data");
  const larkEnabled = booleanValue(
    environment.WAYFINDER_LARK_ENABLED,
    false,
    "WAYFINDER_LARK_ENABLED",
    issues,
  );
  const modelEnabled = booleanValue(
    environment.WAYFINDER_MODEL_ENABLED,
    false,
    "WAYFINDER_MODEL_ENABLED",
    issues,
  );
  const appId = optionalSecret(environment.WAYFINDER_LARK_APP_ID);
  const appSecret = optionalSecret(environment.WAYFINDER_LARK_APP_SECRET);
  const modelProvider = optionalSecret(environment.WAYFINDER_MODEL_PROVIDER);
  const modelId = optionalSecret(environment.WAYFINDER_MODEL_ID);
  const modelApiKey = optionalSecret(environment.WAYFINDER_MODEL_API_KEY);
  const userRoles = roleMap(environment.WAYFINDER_USER_ROLES, issues);
  const allowedChatIds = identifierSet(
    environment.WAYFINDER_ALLOWED_CHAT_IDS,
    "WAYFINDER_ALLOWED_CHAT_IDS",
    issues,
  );

  if (larkEnabled) {
    if (!appId) issues.push("WAYFINDER_LARK_APP_ID is required when Lark is enabled");
    if (!appSecret) issues.push("WAYFINDER_LARK_APP_SECRET is required when Lark is enabled");
    if (userRoles.size === 0)
      issues.push("WAYFINDER_USER_ROLES must contain at least one user when Lark is enabled");
    if (!modelEnabled) issues.push("WAYFINDER_MODEL_ENABLED must be true when Lark is enabled");
  }
  if (modelEnabled) {
    if (modelProvider !== "openai" && modelProvider !== "anthropic") {
      issues.push("WAYFINDER_MODEL_PROVIDER must be openai or anthropic");
    }
    if (!modelId) issues.push("WAYFINDER_MODEL_ID is required when the model is enabled");
    if (!modelApiKey) issues.push("WAYFINDER_MODEL_API_KEY is required when the model is enabled");
  }

  const wifiInterface = environment.WAYFINDER_WIFI_INTERFACE?.trim() || "wlp2s0";
  if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(wifiInterface)) {
    issues.push("WAYFINDER_WIFI_INTERFACE contains invalid characters");
  }
  const healthHost = environment.WAYFINDER_HEALTH_HOST?.trim() || "127.0.0.1";
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(healthHost)) {
    issues.push("WAYFINDER_HEALTH_HOST must be a loopback address");
  }
  const healthPort = integerValue(
    environment.WAYFINDER_HEALTH_PORT,
    3030,
    "WAYFINDER_HEALTH_PORT",
    1,
    65_535,
    issues,
  );
  const commandTimeoutMs = integerValue(
    environment.WAYFINDER_COMMAND_TIMEOUT_MS,
    5_000,
    "WAYFINDER_COMMAND_TIMEOUT_MS",
    100,
    30_000,
    issues,
  );
  const maximumOutputBytes = integerValue(
    environment.WAYFINDER_MAX_COMMAND_OUTPUT_BYTES,
    256_000,
    "WAYFINDER_MAX_COMMAND_OUTPUT_BYTES",
    1_024,
    2_000_000,
    issues,
  );
  const maximumConcurrentCommands = integerValue(
    environment.WAYFINDER_MAX_CONCURRENT_COMMANDS,
    4,
    "WAYFINDER_MAX_CONCURRENT_COMMANDS",
    1,
    16,
    issues,
  );
  const modelTimeoutMs = integerValue(
    environment.WAYFINDER_MODEL_TIMEOUT_MS,
    60_000,
    "WAYFINDER_MODEL_TIMEOUT_MS",
    1_000,
    180_000,
    issues,
  );
  const maximumConcurrentRequests = integerValue(
    environment.WAYFINDER_MAX_CONCURRENT_REQUESTS,
    4,
    "WAYFINDER_MAX_CONCURRENT_REQUESTS",
    1,
    32,
    issues,
  );
  const maximumQueuedRequests = integerValue(
    environment.WAYFINDER_MAX_QUEUED_REQUESTS,
    32,
    "WAYFINDER_MAX_QUEUED_REQUESTS",
    0,
    1_000,
    issues,
  );
  const maximumMessageCharacters = integerValue(
    environment.WAYFINDER_MAX_MESSAGE_CHARACTERS,
    4_000,
    "WAYFINDER_MAX_MESSAGE_CHARACTERS",
    1,
    20_000,
    issues,
  );
  if (issues.length > 0) throw new ConfigurationError(issues);

  return {
    environment: mode as AppConfig["environment"],
    dataDirectory,
    businessDatabasePath: resolve(dataDirectory, "wayfinder.sqlite"),
    piDatabasePath: resolve(dataDirectory, "pi-sessions.sqlite"),
    health: {
      host: healthHost,
      port: healthPort,
    },
    tools: {
      wifiInterface,
      commandTimeoutMs,
      maximumOutputBytes,
      maximumConcurrentCommands,
    },
    lark: {
      enabled: larkEnabled,
      ...(appId ? { appId } : {}),
      ...(appSecret ? { appSecret } : {}),
      userRoles,
      allowedChatIds,
    },
    model: {
      enabled: modelEnabled,
      ...(modelProvider === "openai" || modelProvider === "anthropic" ? { provider: modelProvider } : {}),
      ...(modelId ? { modelId } : {}),
      ...(modelApiKey ? { apiKey: modelApiKey } : {}),
      timeoutMs: modelTimeoutMs,
    },
    service: {
      maximumConcurrentRequests,
      maximumQueuedRequests,
      maximumMessageCharacters,
    },
  };
}
