import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("architecture boundaries", () => {
  it("keeps child_process confined to the process adapter", async () => {
    const sourceRoot = resolve("src");
    const allowedAdapter = "tools/adapters/process-runner.ts";
    for (const file of await typescriptFiles(sourceRoot)) {
      const projectPath = relative(sourceRoot, file).replaceAll("\\", "/");
      const contents = await readFile(file, "utf8");
      if (projectPath !== allowedAdapter) expect(contents).not.toContain("node:child_process");
      expect(contents).not.toContain("shell: true");
    }
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}
