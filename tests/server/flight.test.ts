import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeAeroDataBox, normalizeDeparture, fetchFlight, fetchDeparture, concourseFrom, airlineFromFlightNumber } from "../../src/server/guests/flight";

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; delete process.env.AERODATABOX_API_KEY; });

function adbx(o: { status?: string; gate?: string; terminal?: string; from?: string; country?: string; to?: string; revised?: string; runway?: string; airline?: string; depart?: string } = {}) {
  return {
    number: "DL 1234",
    status: o.status ?? "Expected",
    airline: { iata: o.airline ?? "DL", name: "Delta Air Lines" },
    departure: {
      airport: { iata: o.from ?? "LGA", countryCode: o.country ?? "US" },
      scheduledTime: { utc: o.depart ?? "2026-09-20 10:00Z", local: "2026-09-20 06:00-04:00" },
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
  it("multiple legs into ATL: picks the leg whose departure date matches flightDate, else the first", () => {
    const legA = adbx({ depart: "2026-09-19 10:00Z", gate: "A1" });
    const legB = adbx({ depart: "2026-09-20 10:00Z", gate: "B2" });
    expect(normalizeAeroDataBox([legA, legB], "2026-09-20")!.gate).toBe("B2");
    expect(normalizeAeroDataBox([legA, legB], "2026-09-25")!.gate).toBe("A1");
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
      expect.objectContaining({ headers: { "x-api-market-key": "k" }, signal: expect.any(AbortSignal) }),
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
    global.fetch = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")) as unknown as typeof fetch;
    expect((await fetchFlight("DL1234", "2026-09-20")).ok).toBe(false);
  });
});

// DL88: ATL 18:10 ET (22:10Z) -> BOS on 2026-09-23.
function home(o: { status?: string; gate?: string; revised?: string; runway?: string; depart?: string; from?: string; to?: string } = {}) {
  return {
    number: "DL 88",
    status: o.status ?? "Expected",
    airline: { iata: "DL" },
    departure: {
      airport: { iata: o.from ?? "ATL", countryCode: "US" },
      scheduledTime: { utc: o.depart ?? "2026-09-23 22:10Z" },
      ...(o.revised ? { revisedTime: { utc: o.revised } } : {}),
      ...(o.runway ? { runwayTime: { utc: o.runway } } : {}),
      ...(o.gate ? { gate: o.gate } : {}),
    },
    arrival: { airport: { iata: o.to ?? "BOS", countryCode: "US" }, scheduledTime: { utc: "2026-09-24 00:40Z" } },
  };
}

describe("normalizeDeparture", () => {
  it("reads the ATL leg: destination, gate, schedule", () => {
    expect(normalizeDeparture([home({ gate: "B12" })], "2026-09-23")).toEqual({
      state: "scheduled", destination: "BOS", gate: "B12",
      scheduledDeparture: "2026-09-23T22:10:00.000Z", estimatedDeparture: null, departedAt: null,
    });
  });
  it("maps boarding, gate closed, gone, cancelled", () => {
    const st = (s: string) => normalizeDeparture([home({ status: s })], "2026-09-23")!.state;
    expect(st("Boarding")).toBe("boarding");
    expect(st("GateClosed")).toBe("boarding");
    for (const s of ["Departed", "EnRoute", "Approaching", "Arrived", "Diverted"]) expect(st(s)).toBe("departed");
    expect(st("Canceled")).toBe("cancelled");
    expect(st("Delayed")).toBe("scheduled");
    expect(st("Unknown")).toBe("unknown");
  });
  it("revised time is the estimate; runway time is when it left", () => {
    const s = normalizeDeparture([home({ status: "Departed", revised: "2026-09-23 22:50Z", runway: "2026-09-23 23:02Z" })], "2026-09-23")!;
    expect(s.estimatedDeparture).toBe("2026-09-23T22:50:00.000Z");
    expect(s.departedAt).toBe("2026-09-23T23:02:00.000Z");
  });
  it("ignores legs that don't leave ATL; picks the leg on the ticket date", () => {
    expect(normalizeDeparture([home({ from: "LGA", to: "ATL" })], "2026-09-23")).toBeNull();
    const legs = [home({ from: "LGA", to: "ATL", depart: "2026-09-23 18:00Z" }), home({ depart: "2026-09-22 22:10Z", to: "MIA" }), home({ to: "BOS" })];
    expect(normalizeDeparture(legs, "2026-09-23")!.destination).toBe("BOS");
  });
});

describe("fetchDeparture", () => {
  it("shares the endpoint and error handling with arrivals", async () => {
    process.env.AERODATABOX_API_KEY = "k";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify([home({ gate: "D4" })]) }) as unknown as typeof fetch;
    expect(await fetchDeparture("DL88", "2026-09-23")).toMatchObject({ ok: true, snapshot: { gate: "D4", destination: "BOS" } });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }) as unknown as typeof fetch;
    expect(await fetchDeparture("DL88", "2026-09-23")).toEqual({ ok: true, snapshot: null });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "x" }) as unknown as typeof fetch;
    expect((await fetchDeparture("DL88", "2026-09-23")).ok).toBe(false);
  });
});
