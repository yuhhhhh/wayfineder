import { Type } from "typebox";
import type { Clock } from "../../shared/types.js";
import type { ProcessRunner } from "../adapters/process-runner.js";
import { EmptyToolParameters, envelopeSchema, type ToolDefinition } from "../contracts.js";

export interface DockerContainerStatus {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface DockerStatusData {
  available: boolean;
  containers: DockerContainerStatus[];
  truncated: boolean;
}

const dataSchema = Type.Object(
  {
    available: Type.Boolean(),
    containers: Type.Array(
      Type.Object(
        {
          id: Type.String({ maxLength: 64 }),
          name: Type.String({ maxLength: 128 }),
          image: Type.String({ maxLength: 256 }),
          state: Type.String({ maxLength: 64 }),
          status: Type.String({ maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export function createDockerStatusTool(
  runner: ProcessRunner,
  clock: Clock,
  options: { timeoutMs: number; maximumOutputBytes: number },
): ToolDefinition<DockerStatusData> {
  return {
    name: "get_docker_status",
    label: "Docker status",
    description:
      "Read the visible Docker container list. Returns unavailable when no constrained Docker access exists.",
    risk: "read_only",
    executionMode: "parallel",
    parameters: EmptyToolParameters,
    outputSchema: envelopeSchema(dataSchema),
    execute: async (signal) => {
      const started = performance.now();
      const result = await runner.run(
        {
          executable: "/usr/bin/docker",
          args: ["ps", "--all", "--no-trunc", "--format", "{{json .}}"],
          timeoutMs: options.timeoutMs,
          maximumOutputBytes: options.maximumOutputBytes,
        },
        signal,
      );
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
          data: { available: false, containers: [], truncated: false },
          warnings: [`docker_${result.errorType}`],
        };
      }
      const parsed = parseDockerPs(result.stdout);
      return {
        schemaVersion: 1,
        status: parsed.malformedLines > 0 ? "partial" : "ok",
        observedAt: clock.now().toISOString(),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        data: { available: true, containers: parsed.containers, truncated: parsed.truncated },
        warnings: [
          ...(parsed.malformedLines > 0 ? ["docker_output_partially_malformed"] : []),
          ...(parsed.truncated ? ["docker_list_truncated"] : []),
        ],
      };
    },
  };
}

export function parseDockerPs(output: string): {
  containers: DockerContainerStatus[];
  malformedLines: number;
  truncated: boolean;
} {
  const containers: DockerContainerStatus[] = [];
  let malformedLines = 0;
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (
        ![row.ID, row.Names, row.Image, row.State, row.Status].every((value) => typeof value === "string")
      ) {
        malformedLines += 1;
        continue;
      }
      containers.push({
        id: stringField(row.ID, 64),
        name: stringField(row.Names, 128),
        image: stringField(row.Image, 256),
        state: stringField(row.State, 64),
        status: stringField(row.Status, 256),
      });
    } catch {
      malformedLines += 1;
    }
  }
  return { containers: containers.slice(0, 100), malformedLines, truncated: containers.length > 100 };
}

function stringField(value: unknown, maximum: number): string {
  return (value as string).slice(0, maximum);
}
