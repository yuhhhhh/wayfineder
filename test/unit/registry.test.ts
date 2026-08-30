import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "../../src/shared/types.js";
import type { FixedCommand, ProcessResult, ProcessRunner } from "../../src/tools/adapters/process-runner.js";
import { createReadOnlyToolRegistry } from "../../src/tools/registry.js";
import { createTemporaryDatabase } from "../utils/database.js";

class RecordingRunner implements ProcessRunner {
  readonly commands: FixedCommand[] = [];

  async run(command: FixedCommand): Promise<ProcessResult> {
    this.commands.push(command);
    const joined = command.args.join(" ");
    if (joined.endsWith(" link")) return { ok: true, stdout: "Not connected.\n", durationMs: 1, exitCode: 0 };
    if (joined.includes("address show")) return { ok: true, stdout: "[]", durationMs: 1, exitCode: 0 };
    if (joined.includes("route show")) return { ok: true, stdout: "[]", durationMs: 1, exitCode: 0 };
    return { ok: true, stdout: "", durationMs: 1, exitCode: 0 };
  }
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
const ids: IdGenerator = { next: () => "fixed-id" };

describe("read-only tool registry", () => {
  it("registers exactly the five allowed read-only tools", async () => {
    const temporary = await createTemporaryDatabase(ids);
    const runner = new RecordingRunner();
    try {
      const registry = createReadOnlyToolRegistry({
        runner,
        clock,
        database: temporary.database,
        config: temporary.config,
      });
      expect(registry.names().sort()).toEqual([
        "get_disk_status",
        "get_docker_status",
        "get_nas_overview",
        "get_recent_alerts",
        "get_wifi_status",
      ]);
      expect(registry.get("bash")).toBeUndefined();
      expect(registry.get("read_file")).toBeUndefined();
      expect(registry.get("restart_container")).toBeUndefined();
      for (const name of registry.names()) {
        const definition = registry.get(name);
        if (!definition) throw new Error(`Expected ${name} definition`);
        expect(Value.Check(definition.parameters, {})).toBe(true);
        expect(Value.Check(definition.parameters, { injected: true })).toBe(false);
      }
    } finally {
      await temporary.close();
    }
  });

  it("uses the exact fixed iw commands and rejects extra tool parameters", async () => {
    const temporary = await createTemporaryDatabase(ids);
    const runner = new RecordingRunner();
    try {
      const registry = createReadOnlyToolRegistry({
        runner,
        clock,
        database: temporary.database,
        config: temporary.config,
      });
      const definition = registry.get("get_wifi_status");
      expect(definition).toBeDefined();
      if (!definition) throw new Error("Expected get_wifi_status definition");
      expect(Value.Check(definition.parameters, { injected: "value" })).toBe(false);
      const tool = registry.toAgentTools().find((candidate) => candidate.name === "get_wifi_status");
      if (!tool) throw new Error("Expected get_wifi_status agent tool");
      const result = await tool.execute("call-1", {}, undefined);
      expect(result.details).toMatchObject({ status: "ok", data: { connected: false } });
      const agentTools = registry.toAgentTools();
      const disk = agentTools.find((candidate) => candidate.name === "get_disk_status");
      const docker = agentTools.find((candidate) => candidate.name === "get_docker_status");
      if (!disk || !docker) throw new Error("Expected disk and Docker agent tools");
      await disk.execute("call-2", {}, undefined);
      await docker.execute("call-3", {}, undefined);
      expect(runner.commands.map(({ executable, args }) => [executable, args])).toEqual([
        ["/sbin/iw", ["dev", "wlp2s0", "link"]],
        ["/sbin/iw", ["dev", "wlp2s0", "station", "dump"]],
        ["/sbin/iw", ["reg", "get"]],
        ["/usr/sbin/ip", ["-json", "address", "show", "dev", "wlp2s0"]],
        ["/usr/sbin/ip", ["-json", "route", "show", "default", "dev", "wlp2s0"]],
        ["/bin/df", ["-P", "-B1"]],
        ["/usr/bin/docker", ["ps", "--all", "--no-trunc", "--format", "{{json .}}"]],
      ]);
    } finally {
      await temporary.close();
    }
  });
});
