import { Type } from "typebox";
import type { Clock, ToolEnvelope } from "../../shared/types.js";
import type { ProcessRunner } from "../adapters/process-runner.js";
import { EmptyToolParameters, envelopeSchema, type ToolDefinition } from "../contracts.js";

export interface DiskMount {
  filesystem: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  severity: "normal" | "warning" | "critical";
}

export interface DiskStatusData {
  mounts: DiskMount[];
  smartStatus: "not_collected";
  ioErrorStatus: "not_collected";
  truncated: boolean;
}

const dataSchema = Type.Object(
  {
    mounts: Type.Array(
      Type.Object(
        {
          filesystem: Type.String({ maxLength: 128 }),
          mountPoint: Type.String({ maxLength: 256 }),
          totalBytes: Type.Number({ minimum: 0 }),
          usedBytes: Type.Number({ minimum: 0 }),
          availableBytes: Type.Number({ minimum: 0 }),
          usagePercent: Type.Number({ minimum: 0, maximum: 100 }),
          severity: Type.Union([Type.Literal("normal"), Type.Literal("warning"), Type.Literal("critical")]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    smartStatus: Type.Literal("not_collected"),
    ioErrorStatus: Type.Literal("not_collected"),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export function createDiskStatusTool(
  runner: ProcessRunner,
  clock: Clock,
  options: { timeoutMs: number; maximumOutputBytes: number },
): ToolDefinition<DiskStatusData> {
  return {
    name: "get_disk_status",
    label: "Disk status",
    description: "Read mounted filesystem capacity and usage thresholds without accessing file contents.",
    risk: "read_only",
    executionMode: "parallel",
    parameters: EmptyToolParameters,
    outputSchema: envelopeSchema(dataSchema),
    execute: async (signal) => {
      const started = performance.now();
      const result = await runner.run(
        {
          executable: "/bin/df",
          args: ["-P", "-B1"],
          timeoutMs: options.timeoutMs,
          maximumOutputBytes: options.maximumOutputBytes,
        },
        signal,
      );
      const base: DiskStatusData = {
        mounts: [],
        smartStatus: "not_collected",
        ioErrorStatus: "not_collected",
        truncated: false,
      };
      if (!result.ok) {
        return {
          schemaVersion: 1,
          status:
            result.errorType === "timeout"
              ? "timeout"
              : result.errorType === "permission_denied"
                ? "permission_denied"
                : "unavailable",
          observedAt: clock.now().toISOString(),
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          data: base,
          warnings: [`disk_capacity_${result.errorType}`],
        };
      }
      const parsed = parseDf(result.stdout);
      return {
        schemaVersion: 1,
        status: parsed.malformedLines > 0 ? "partial" : "ok",
        observedAt: clock.now().toISOString(),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        data: {
          ...base,
          mounts: parsed.mounts,
          truncated: parsed.truncated,
        },
        warnings: [
          "smart_not_collected",
          "io_errors_not_collected",
          ...(parsed.malformedLines > 0 ? ["disk_output_partially_malformed"] : []),
          ...(parsed.truncated ? ["disk_list_truncated"] : []),
        ],
      } satisfies ToolEnvelope<DiskStatusData>;
    },
  };
}

export function parseDf(output: string): { mounts: DiskMount[]; malformedLines: number; truncated: boolean } {
  const lines = output.split(/\r?\n/).slice(1).filter(Boolean);
  const mounts: DiskMount[] = [];
  let malformedLines = 0;
  for (const line of lines) {
    const match = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line.trim());
    if (!match) {
      malformedLines += 1;
      continue;
    }
    const [
      ,
      filesystem = "unknown",
      total = "0",
      used = "0",
      available = "0",
      percent = "0",
      mount = "unknown",
    ] = match;
    const usagePercent = Math.max(0, Math.min(100, Number(percent)));
    mounts.push({
      filesystem: filesystem.slice(0, 128),
      mountPoint: mount.slice(0, 256),
      totalBytes: Number(total),
      usedBytes: Number(used),
      availableBytes: Number(available),
      usagePercent,
      severity: usagePercent > 90 ? "critical" : usagePercent > 80 ? "warning" : "normal",
    });
  }
  return { mounts: mounts.slice(0, 64), malformedLines, truncated: mounts.length > 64 };
}
