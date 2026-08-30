import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os";
import { Type } from "typebox";
import type { Clock, ToolEnvelope } from "../../shared/types.js";
import { EmptyToolParameters, envelopeSchema, type ToolDefinition } from "../contracts.js";

export interface NasOverviewData {
  hostname: string;
  uptimeSeconds: number;
  cpuCount: number;
  loadAverage: [number, number, number];
  memory: { totalBytes: number; usedBytes: number; usagePercent: number };
}

const dataSchema = Type.Object(
  {
    hostname: Type.String({ maxLength: 255 }),
    uptimeSeconds: Type.Number({ minimum: 0 }),
    cpuCount: Type.Integer({ minimum: 1 }),
    loadAverage: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
    memory: Type.Object(
      {
        totalBytes: Type.Number({ minimum: 0 }),
        usedBytes: Type.Number({ minimum: 0 }),
        usagePercent: Type.Number({ minimum: 0, maximum: 100 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export function createNasOverviewTool(clock: Clock): ToolDefinition<NasOverviewData> {
  return {
    name: "get_nas_overview",
    label: "NAS overview",
    description: "Read CPU, memory, load, and uptime for this NAS.",
    risk: "read_only",
    executionMode: "parallel",
    parameters: EmptyToolParameters,
    outputSchema: envelopeSchema(dataSchema),
    execute: async () => {
      const started = performance.now();
      const total = totalmem();
      const used = Math.max(0, total - freemem());
      const loads = loadavg();
      const result: ToolEnvelope<NasOverviewData> = {
        schemaVersion: 1,
        status: "ok",
        observedAt: clock.now().toISOString(),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        data: {
          hostname: hostname().slice(0, 255),
          uptimeSeconds: Math.max(0, Math.round(uptime())),
          cpuCount: Math.max(1, cpus().length),
          loadAverage: [loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0],
          memory: {
            totalBytes: total,
            usedBytes: used,
            usagePercent: total === 0 ? 0 : Math.round((used / total) * 10_000) / 100,
          },
        },
        warnings: [],
      };
      return result;
    },
  };
}
