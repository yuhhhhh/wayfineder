import { describe, expect, it } from "vitest";
import { parseDf } from "../../src/tools/read-only/disk-status.js";
import { parseDockerPs } from "../../src/tools/read-only/docker-status.js";
import { parseIwLink } from "../../src/tools/read-only/wifi-status.js";

describe("NAS output parsers", () => {
  it("parses the known 5240 MHz Wi-Fi link as channel 48 on 5 GHz", () => {
    const parsed = parseIwLink(`Connected to 00:11:22:33:44:55 (on wlp2s0)
\tSSID: Blazar_5G
\tfreq: 5240
\tsignal: -48 dBm
\trx bitrate: 390.0 MBit/s
\ttx bitrate: 433.3 MBit/s`);
    expect(parsed).toMatchObject({
      connected: true,
      ssid: "Blazar_5G",
      frequencyMHz: 5240,
      band: "5GHz",
      channel: 48,
      signalDbm: -48,
    });
  });

  it("reports a disconnected Wi-Fi link without inventing fields", () => {
    expect(parseIwLink("Not connected.\n")).toEqual({ connected: false });
  });

  it("applies strict disk thresholds and preserves spaced mount points", () => {
    const parsed = parseDf(`Filesystem 1-blocks Used Available Capacity Mounted on
/dev/a 100 81 19 81% /volume one
/dev/b 100 91 9 91% /critical`);
    expect(parsed.mounts.map((mount) => mount.severity)).toEqual(["warning", "critical"]);
    expect(parsed.mounts[0]?.mountPoint).toBe("/volume one");
  });

  it("bounds Docker fields and counts malformed rows", () => {
    const parsed = parseDockerPs(
      `${JSON.stringify({ ID: "abc", Names: "media", Image: "image:latest", State: "running", Status: "Up 1 hour" })}\nnot-json`,
    );
    expect(parsed.containers).toHaveLength(1);
    expect(parsed.malformedLines).toBe(1);
  });
});
