import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import type { RiskLevel, ToolEnvelope } from "../shared/types.js";

export const ReadOnlyToolNameSchema = Type.Union([
  Type.Literal("get_nas_overview"),
  Type.Literal("get_wifi_status"),
  Type.Literal("get_disk_status"),
  Type.Literal("get_docker_status"),
  Type.Literal("get_recent_alerts"),
]);

export type ReadOnlyToolName = Static<typeof ReadOnlyToolNameSchema>;

export const EmptyToolParameters = Type.Object({}, { additionalProperties: false });

export interface ToolDefinition<TData> {
  name: ReadOnlyToolName;
  label: string;
  description: string;
  risk: RiskLevel;
  executionMode: "parallel";
  parameters: typeof EmptyToolParameters;
  outputSchema: TSchema;
  execute(signal?: AbortSignal): Promise<ToolEnvelope<TData>>;
}

export const envelopeSchema = <T extends TSchema>(data: T) =>
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      status: Type.Union([
        Type.Literal("ok"),
        Type.Literal("partial"),
        Type.Literal("unavailable"),
        Type.Literal("timeout"),
        Type.Literal("permission_denied"),
        Type.Literal("malformed_output"),
        Type.Literal("internal_error"),
      ]),
      observedAt: Type.String({ format: "date-time" }),
      durationMs: Type.Number({ minimum: 0 }),
      data,
      warnings: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 }),
    },
    { additionalProperties: false },
  );
