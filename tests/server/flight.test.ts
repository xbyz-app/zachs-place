import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeAeroDataBox, fetchFlight, concourseFrom, airlineFromFlightNumber } from "../../src/server/guests/flight";

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; delete process.env.AERODATABOX_API_KEY; });

function adbx(o: { status?: string; gate?: string; terminal?: string; from?: string; country?: string; to?: string; revised?: string; runway?: string; airline?: string } = {}) {
  return {
    number: "DL 1234",
    status: o.status ?? "Expected",
    airline: { iata: o.airline ?? "DL", name: "Delta Air Lines" },
    departure: {
      airport: { iata: o.from ?? "LGA", countryCode: o.country ?? "US" },
      scheduledTime: { utc: "2026-09-20 10:00Z", local: "2026-09-20 06:00-04:00" },
    },
    arrival: {
      airport: { iata: o.to ?? "ATL", countryCode: "US" },
      scheduledTime: { utc: "2026-09-20 12:25Z", local: "2026-09-20 08:25-04:00" },
      ...(o.revised ? { revisedTime: { utc: o.revised } } : {}),
      ...(o.runway ? { runwayTime: { utc: o.runway } } : {}),
      ...(o.gate ? { gate: o.gate } : {}),
      ...(o.terminal ? { terminal: o.terminal } : {}),
    },
  };
}

describe("concourseFrom", () => {
  it("uses the gate letter first, then a single-letter terminal", () => {
    expect(concourseFrom("B12", "S")).toBe("B");
    expect(concourseFrom(" t5 ", null)).toBe("T");
    expect(concourseFrom(null, "E")).toBe("E");
    expect(concourseFrom(null, "I")).toBe("F");
    expect(concourseFrom("12", "S")).toBeNull();
    expect(concourseFrom(null, null)).toBeNull();
  });
});

describe("airlineFromFlightNumber", () => {
  it("takes the two-character prefix", () => {
    expect(airlineFromFlightNumber("DL1234")).toBe("DL");
    expect(airlineFromFlightNumber("B6123")).toBe("B6");
    expect(airlineFromFlightNumber(null)).toBeNull();
  });
});

describe("normalizeAeroDataBox", () => {
  it("scheduled domestic flight, no gate yet", () => {
    expect(normalizeAeroDataBox([adbx()], "2026-09-20")).toEqual({
      state: "scheduled", airline: "DL", arrivalAirport: "ATL", international: false,
      gate: null, terminal: null, concourse: null,
      scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z",
      estimatedArrival: null, landedAt: null,
    });
  });
  it("en route with a gate and a revised time", () => {
    const s = normalizeAeroDataBox({ data: [adbx({ status: "EnRoute", gate: "B12", revised: "2026-09-20 13:10Z" })] }, "2026-09-20")!;
    expect(s.state).toBe("departed");
    expect(s.concourse).toBe("B");
    expect(s.estimatedArrival).toBe("2026-09-20T13:10:00.000Z");
  });
  it("arrived: landedAt prefers runway time", () => {
    const s = normalizeAeroDataBox([adbx({ status: "Arrived", gate: "T5", runway: "2026-09-20 12:19Z", revised: "2026-09-20 12:30Z" })], "2026-09-20")!;
    expect(s.state).toBe("landed");
    expect(s.landedAt).toBe("2026-09-20T12:19:00.000Z");
  });
  it("maps cancel/divert/unknown statuses; Approaching is NOT landed", () => {
    const st = (status: string) => normalizeAeroDataBox([adbx({ status })], "2026-09-20")!.state;
    expect(st("Canceled")).toBe("cancelled");
    expect(st("CanceledUncertain")).toBe("cancelled");
    expect(st("Diverted")).toBe("diverted");
    expect(st("Approaching")).toBe("departed");
    expect(st("Unknown")).toBe("unknown");
    expect(st("Boarding")).toBe("scheduled");
  });
  it("international vs preclearance vs missing country", () => {
    const intl = (from: string, country: string) => normalizeAeroDataBox([adbx({ from, country })], "2026-09-20")!.international;
    expect(intl("CDG", "FR")).toBe(true);
    expect(intl("YYZ", "CA")).toBe(false); // US preclearance: arrives as domestic
    expect(intl("SJU", "PR")).toBe(false);
    expect(intl("LGA", "")).toBeNull();
  });
  it("only returns a leg arriving ATL", () => {
    expect(normalizeAeroDataBox([adbx({ to: "MCO" })], "2026-09-20")).toBeNull();
    expect(normalizeAeroDataBox([], "2026-09-20")).toBeNull();
    expect(normalizeAeroDataBox("garbage", "2026-09-20")).toBeNull();
  });
});

describe("fetchFlight", () => {
  it("calls api.market with the key and normalizes", async () => {
    process.env.AERODATABOX_API_KEY = "k";
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify([adbx({ gate: "C3" })]) });
    global.fetch = f as unknown as typeof fetch;
    const r = await fetchFlight("DL1234", "2026-09-20");
    expect(f).toHaveBeenCalledWith(
      "https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/DL1234/2026-09-20",
      expect.objectContaining({ headers: { "x-api-market-key": "k" } }),
    );
    expect(r).toMatchObject({ ok: true, snapshot: { concourse: "C" } });
  });
  it("204/404/empty body are not-found, not errors", async () => {
    process.env.AERODATABOX_API_KEY = "k";
    for (const res of [{ ok: false, status: 404, text: async () => "" }, { ok: true, status: 204, text: async () => "" }]) {
      global.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
      expect(await fetchFlight("DL1234", "2026-09-20")).toEqual({ ok: true, snapshot: null });
    }
  });
  it("5xx, network errors and a missing key are errors, and never throw", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }) as unknown as typeof fetch;
    expect((await fetchFlight("DL1234", "2026-09-20")).ok).toBe(false); // no key
    process.env.AERODATABOX_API_KEY = "k";
    expect(await fetchFlight("DL1234", "2026-09-20")).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    expect(await fetchFlight("DL1234", "2026-09-20")).toMatchObject({ ok: false, error: expect.stringContaining("ECONNRESET") });
  });
});
