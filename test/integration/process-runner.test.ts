import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import { SpawnProcessRunner } from "../../src/tools/adapters/process-runner.js";

const command = (args: string[], timeoutMs = 2_000, maximumOutputBytes = 16_000) => ({
  executable: process.execPath,
  args,
  timeoutMs,
  maximumOutputBytes,
});

describe("controlled process runner", () => {
  it("runs an absolute executable without a shell and with a minimal environment", async () => {
    const runner = new SpawnProcessRunner(1, 1);
    const result = await runner.run(
      command([
        "-e",
        "process.stdout.write(JSON.stringify({nodeEnv:process.env.NODE_ENV,path:process.env.PATH}))",
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.stdout)).toEqual({ path: "/usr/sbin:/usr/bin:/sbin:/bin" });
  });

  it("maps nonzero, missing, output-limit, timeout, and abort failures", async () => {
    const runner = new SpawnProcessRunner(2, 4);
    await expect(runner.run(command(["-e", "process.exit(7)"]))).resolves.toMatchObject({
      ok: false,
      errorType: "nonzero_exit",
      exitCode: 7,
    });
    await expect(
      runner.run({
        ...command([]),
        executable: join(parse(process.execPath).root, "definitely-missing-wayfinder-binary"),
      }),
    ).resolves.toMatchObject({ ok: false, errorType: "not_found" });
    await expect(
      runner.run(
        command(
          ["-e", "process.stdout.write('a'.repeat(2048));process.stderr.write('b'.repeat(2048))"],
          2_000,
          1_000,
        ),
      ),
    ).resolves.toMatchObject({ ok: false, errorType: "output_limit" });
    await expect(runner.run(command(["-e", "setInterval(()=>{},1000)"], 50))).resolves.toMatchObject({
      ok: false,
      errorType: "timeout",
    });

    const controller = new AbortController();
    const aborted = runner.run(command(["-e", "setInterval(()=>{},1000)"]), controller.signal);
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ ok: false, errorType: "aborted" });
  });

  it("rejects relative executable paths before spawning", async () => {
    const runner = new SpawnProcessRunner(1, 0);
    await expect(
      runner.run({ executable: "node", args: [], timeoutMs: 100, maximumOutputBytes: 1_000 }),
    ).resolves.toEqual({ ok: false, errorType: "spawn_error", durationMs: 0 });
  });
});
