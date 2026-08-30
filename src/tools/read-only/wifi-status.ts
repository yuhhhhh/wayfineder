import { Type } from "typebox";
import type { Clock, ToolEnvelope } from "../../shared/types.js";
import type { FixedCommand, ProcessResult, ProcessRunner } from "../adapters/process-runner.js";
import { EmptyToolParameters, envelopeSchema, type ToolDefinition } from "../contracts.js";

export interface WifiStatusData {
  interface: string;
  connected: boolean;
  ssid?: string;
  frequencyMHz?: number;
  band?: "2.4GHz" | "5GHz" | "6GHz" | "unknown";
  channel?: number;
  signalDbm?: number;
  rxBitrateMbps?: number;
  txBitrateMbps?: number;
  regulatoryCountry?: string;
  addresses: string[];
  gateway?: string;
  gatewayReachability: "not_checked";
}

const dataSchema = Type.Object(
  {
    interface: Type.String({ maxLength: 32 }),
    connected: Type.Boolean(),
    ssid: Type.Optional(Type.String({ maxLength: 128 })),
    frequencyMHz: Type.Optional(Type.Number({ minimum: 1 })),
    band: Type.Optional(
      Type.Union([
        Type.Literal("2.4GHz"),
        Type.Literal("5GHz"),
        Type.Literal("6GHz"),
        Type.Literal("unknown"),
      ]),
    ),
    channel: Type.Optional(Type.Number({ minimum: 1 })),
    signalDbm: Type.Optional(Type.Number({ minimum: -200, maximum: 20 })),
    rxBitrateMbps: Type.Optional(Type.Number({ minimum: 0 })),
    txBitrateMbps: Type.Optional(Type.Number({ minimum: 0 })),
    regulatoryCountry: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
    addresses: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 }),
    gateway: Type.Optional(Type.String({ maxLength: 64 })),
    gatewayReachability: Type.Literal("not_checked"),
  },
  { additionalProperties: false },
);

interface WifiToolOptions {
  interfaceName: string;
  timeoutMs: number;
  maximumOutputBytes: number;
}

export function createWifiStatusTool(
  runner: ProcessRunner,
  clock: Clock,
  options: WifiToolOptions,
): ToolDefinition<WifiStatusData> {
  const command = (executable: string, args: readonly string[]): FixedCommand => ({
    executable,
    args,
    timeoutMs: options.timeoutMs,
    maximumOutputBytes: options.maximumOutputBytes,
  });

  return {
    name: "get_wifi_status",
    label: "Wi-Fi status",
    description: "Read the configured NAS Wi-Fi interface, link quality, addresses, and regulatory domain.",
    risk: "read_only",
    executionMode: "parallel",
    parameters: EmptyToolParameters,
    outputSchema: envelopeSchema(dataSchema),
    execute: async (signal) => {
      const started = performance.now();
      const [link, station, regulatory, addresses, route] = await Promise.all([
        runner.run(command("/sbin/iw", ["dev", options.interfaceName, "link"]), signal),
        runner.run(command("/sbin/iw", ["dev", options.interfaceName, "station", "dump"]), signal),
        runner.run(command("/sbin/iw", ["reg", "get"]), signal),
        runner.run(
          command("/usr/sbin/ip", ["-json", "address", "show", "dev", options.interfaceName]),
          signal,
        ),
        runner.run(
          command("/usr/sbin/ip", ["-json", "route", "show", "default", "dev", options.interfaceName]),
          signal,
        ),
      ]);
      return buildWifiResult(
        options.interfaceName,
        link,
        station,
        regulatory,
        addresses,
        route,
        clock,
        started,
      );
    },
  };
}

function buildWifiResult(
  interfaceName: string,
  link: ProcessResult,
  station: ProcessResult,
  regulatory: ProcessResult,
  addresses: ProcessResult,
  route: ProcessResult,
  clock: Clock,
  started: number,
): ToolEnvelope<WifiStatusData> {
  const warnings: string[] = [];
  const base: WifiStatusData = {
    interface: interfaceName,
    connected: false,
    addresses: [],
    gatewayReachability: "not_checked",
  };
  if (!link.ok) {
    return {
      schemaVersion: 1,
      status: processStatus(link),
      observedAt: clock.now().toISOString(),
      durationMs: elapsed(started),
      data: base,
      warnings: [`wifi_link_${link.errorType}`],
    };
  }
  const parsed = parseIwLink(link.stdout);
  Object.assign(base, parsed);
  if (parsed.connected === undefined) warnings.push("wifi_link_malformed");
  if (station.ok) Object.assign(base, parseStation(station.stdout));
  else warnings.push(`wifi_station_${station.errorType}`);
  if (regulatory.ok) {
    const country = /country\s+([A-Z]{2}):/m.exec(regulatory.stdout)?.[1];
    if (country) base.regulatoryCountry = country;
  } else warnings.push(`wifi_regulatory_${regulatory.errorType}`);
  if (addresses.ok) {
    const parsedAddresses = parseAddresses(addresses.stdout);
    base.addresses = parsedAddresses.values;
    if (parsedAddresses.malformed) warnings.push("wifi_addresses_malformed");
  } else warnings.push(`wifi_addresses_${addresses.errorType}`);
  if (route.ok) {
    const parsedRoute = parseGateway(route.stdout);
    if (parsedRoute.value) base.gateway = parsedRoute.value;
    if (parsedRoute.malformed) warnings.push("wifi_route_malformed");
  } else warnings.push(`wifi_route_${route.errorType}`);

  return {
    schemaVersion: 1,
    status: warnings.length === 0 ? "ok" : "partial",
    observedAt: clock.now().toISOString(),
    durationMs: elapsed(started),
    data: base,
    warnings,
  };
}

export function parseIwLink(output: string): Partial<WifiStatusData> {
  if (/Not connected\./i.test(output)) return { connected: false };
  const frequencyMHz = numberMatch(output, /^\s*freq:\s*([\d.]+)/m);
  const result: Partial<WifiStatusData> = {
    connected: /Connected to\s+[0-9a-f:]+/i.test(output),
  };
  const ssid = /^\s*SSID:\s*(.+)$/m.exec(output)?.[1]?.trim();
  if (ssid) result.ssid = ssid.slice(0, 128);
  if (frequencyMHz !== undefined) {
    result.frequencyMHz = frequencyMHz;
    result.band = bandForFrequency(frequencyMHz);
    const channel = channelForFrequency(frequencyMHz);
    if (channel !== undefined) result.channel = channel;
  }
  const signal = numberMatch(output, /^\s*signal:\s*(-?[\d.]+)\s*dBm/m);
  if (signal !== undefined) result.signalDbm = signal;
  const rx = numberMatch(output, /^\s*rx bitrate:\s*([\d.]+)/m);
  if (rx !== undefined) result.rxBitrateMbps = rx;
  const tx = numberMatch(output, /^\s*tx bitrate:\s*([\d.]+)/m);
  if (tx !== undefined) result.txBitrateMbps = tx;
  return result;
}

function parseStation(output: string): Partial<WifiStatusData> {
  const result: Partial<WifiStatusData> = {};
  const signal =
    numberMatch(output, /^\s*signal avg:\s*(-?[\d.]+)\s*dBm/m) ??
    numberMatch(output, /^\s*signal:\s*(-?[\d.]+)\s*dBm/m);
  if (signal !== undefined) result.signalDbm = signal;
  const rx = numberMatch(output, /^\s*rx bitrate:\s*([\d.]+)/m);
  if (rx !== undefined) result.rxBitrateMbps = rx;
  const tx = numberMatch(output, /^\s*tx bitrate:\s*([\d.]+)/m);
  if (tx !== undefined) result.txBitrateMbps = tx;
  return result;
}

function parseAddresses(output: string): { values: string[]; malformed: boolean } {
  try {
    const rows = JSON.parse(output) as Array<{ addr_info?: Array<{ local?: unknown }> }>;
    if (!Array.isArray(rows)) return { values: [], malformed: true };
    const values = rows
      .flatMap((row) => row.addr_info ?? [])
      .map((entry) => entry.local)
      .filter((value): value is string => typeof value === "string")
      .slice(0, 8)
      .map((value) => value.slice(0, 64));
    return { values, malformed: false };
  } catch {
    return { values: [], malformed: true };
  }
}

function parseGateway(output: string): { value?: string; malformed: boolean } {
  try {
    const rows = JSON.parse(output) as Array<{ gateway?: unknown }>;
    if (!Array.isArray(rows)) return { malformed: true };
    const gateway = rows.find((row) => typeof row.gateway === "string")?.gateway;
    return typeof gateway === "string"
      ? { value: gateway.slice(0, 64), malformed: false }
      : { malformed: false };
  } catch {
    return { malformed: true };
  }
}

function numberMatch(value: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(value)?.[1];
  if (match === undefined) return undefined;
  const parsed = Number(match);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bandForFrequency(frequencyMHz: number): "2.4GHz" | "5GHz" | "6GHz" | "unknown" {
  if (frequencyMHz >= 2_400 && frequencyMHz <= 2_500) return "2.4GHz";
  if (frequencyMHz >= 5_000 && frequencyMHz < 5_925) return "5GHz";
  if (frequencyMHz >= 5_925 && frequencyMHz <= 7_125) return "6GHz";
  return "unknown";
}

function channelForFrequency(frequencyMHz: number): number | undefined {
  if (frequencyMHz === 2_484) return 14;
  if (frequencyMHz >= 2_412 && frequencyMHz <= 2_472) return Math.round((frequencyMHz - 2_407) / 5);
  if (frequencyMHz >= 5_000 && frequencyMHz <= 5_895) return Math.round((frequencyMHz - 5_000) / 5);
  if (frequencyMHz >= 5_955 && frequencyMHz <= 7_115) return Math.round((frequencyMHz - 5_950) / 5);
  return undefined;
}

function processStatus(
  result: Extract<ProcessResult, { ok: false }>,
): ToolEnvelope<WifiStatusData>["status"] {
  if (result.errorType === "timeout") return "timeout";
  if (result.errorType === "permission_denied") return "permission_denied";
  return "unavailable";
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
