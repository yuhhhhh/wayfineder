import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../../src/shared/redaction.js";

describe("redaction", () => {
  it("removes common bearer and API key shapes", () => {
    const redacted = redactText("Authorization: Bearer abc.def.ghi and sk-thisisasecretvalue");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("sk-thisisasecretvalue");
  });

  it("redacts secret-named object fields recursively", () => {
    expect(redactValue({ nested: { apiKey: "secret", safe: "visible" } })).toEqual({
      nested: { apiKey: "[REDACTED]", safe: "visible" },
    });
  });

  it("redacts paths and filenames from durable summaries", () => {
    expect(redactValue({ path: "/secret/location", filename: "private.txt" })).toEqual({
      path: "[REDACTED]",
      filename: "[REDACTED]",
    });
  });
});
