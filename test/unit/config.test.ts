import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig } from "../../src/config/index.js";

describe("configuration", () => {
  it("loads a safe local-development configuration without credentials", () => {
    const config = loadConfig({ NODE_ENV: "test", WAYFINDER_DATA_DIR: "./test-data" });
    expect(config.lark.enabled).toBe(false);
    expect(config.model.enabled).toBe(false);
    expect(config.health.host).toBe("127.0.0.1");
    expect(config.tools.wifiInterface).toBe("wlp2s0");
  });

  it("requires credentials, roles, and a model when Lark is enabled", () => {
    expect(() => loadConfig({ NODE_ENV: "test", WAYFINDER_LARK_ENABLED: "true" })).toThrow(
      ConfigurationError,
    );
  });

  it("rejects unsafe health bindings and invalid numeric limits", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        WAYFINDER_HEALTH_HOST: "0.0.0.0",
        WAYFINDER_MAX_COMMAND_OUTPUT_BYTES: "unbounded",
      }),
    ).toThrow(ConfigurationError);
  });

  it("does not include secret values in configuration errors", () => {
    const secret = "sk-not-a-real-secret-value";
    try {
      loadConfig({
        NODE_ENV: "test",
        WAYFINDER_LARK_ENABLED: "true",
        WAYFINDER_LARK_APP_SECRET: secret,
      });
      expect.fail("configuration should fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
