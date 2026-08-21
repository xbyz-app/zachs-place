import { describe, it, expect } from "vitest";
import { speakerTile } from "../../src/scripts/controls";

describe("speakerTile", () => {
  it("renders a live volume as a percentage", () => {
    expect(speakerTile(0.2)).toEqual({ offline: false, pct: 20, display: "20%" });
    expect(speakerTile(1)).toEqual({ offline: false, pct: 100, display: "100%" });
  });

  it("treats a muted speaker as live, not offline", () => {
    // The bug this whole tile guards against is confusing "no volume" with
    // "no speaker". 0.0 is a real, reachable speaker turned all the way down.
    expect(speakerTile(0)).toEqual({ offline: false, pct: 0, display: "0%" });
  });

  it("marks the tile offline when HA has no volume for the speaker", () => {
    // null = media_player.zachs_office is unavailable. Measured 2026-08-21:
    // HA no-ops a write to an unavailable entity and /api/volume still answers
    // {"ok":true}, so nothing downstream will ever tell the guest. This is the
    // only place that can.
    expect(speakerTile(null)).toEqual({ offline: true, pct: 0, display: "Offline" });
  });
});
