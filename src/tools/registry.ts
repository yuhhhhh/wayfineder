import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import type { AppConfig } from "../config/index.js";
import type { Clock } from "../shared/types.js";
import type { WayfinderDatabase } from "../storage/database.js";
import type { ProcessRunner } from "./adapters/process-runner.js";
import type { ReadOnlyToolName, ToolDefinition } from "./contracts.js";
import { createDiskStatusTool } from "./read-only/disk-status.js";
import { createDockerStatusTool } from "./read-only/docker-status.js";
import { createNasOverviewTool } from "./read-only/nas-overview.js";
import { createRecentAlertsTool } from "./read-only/recent-alerts.js";
import { createWifiStatusTool } from "./read-only/wifi-status.js";

export class ToolRegistry {
  private readonly definitions: ReadonlyMap<ReadOnlyToolName, ToolDefinition<unknown>>;

  constructor(definitions: readonly ToolDefinition<unknown>[]) {
    const map = new Map<ReadOnlyToolName, ToolDefinition<unknown>>();
    for (const definition of definitions) {
      if (map.has(definition.name)) throw new Error(`Duplicate tool registration: ${definition.name}`);
      map.set(definition.name, definition);
    }
    this.definitions = map;
  }

  get(name: string): ToolDefinition<unknown> | undefined {
    return this.definitions.get(name as ReadOnlyToolName);
  }

  names(): ReadOnlyToolName[] {
    return [...this.definitions.keys()];
  }

  toAgentTools(): AgentTool[] {
    return [...this.definitions.values()].map((definition) => ({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      executionMode: definition.executionMode,
      execute: async (_toolCallId, _parameters, signal) => {
        const result = await definition.execute(signal);
        if (!Value.Check(definition.outputSchema, result)) {
          throw new Error(`Tool ${definition.name} produced an invalid structured result`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    }));
  }
}

export function createReadOnlyToolRegistry(input: {
  runner: ProcessRunner;
  clock: Clock;
  database: WayfinderDatabase;
  config: AppConfig;
}): ToolRegistry {
  const commandOptions = {
    timeoutMs: input.config.tools.commandTimeoutMs,
    maximumOutputBytes: input.config.tools.maximumOutputBytes,
  };
  return new ToolRegistry([
    createNasOverviewTool(input.clock),
    createWifiStatusTool(input.runner, input.clock, {
      ...commandOptions,
      interfaceName: input.config.tools.wifiInterface,
    }),
    createDiskStatusTool(input.runner, input.clock, commandOptions),
    createDockerStatusTool(input.runner, input.clock, commandOptions),
    createRecentAlertsTool(input.database, input.clock),
  ]);
}
