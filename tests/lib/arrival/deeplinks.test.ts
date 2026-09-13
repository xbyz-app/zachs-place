import { describe, it, expect } from "vitest";
import { lyftUrl, uberUrl, appleMapsUrl } from "../../../src/lib/arrival/deeplinks";
import { FAKE_HOME } from "../../helpers/env";

describe("ride deep links", () => {
  it("lyft carries destination coordinates and address", () => {
    const u = new URL(lyftUrl(FAKE_HOME));
    expect(u.origin + u.pathname).toBe("https://lyft.com/ride");
    expect(u.searchParams.get("id")).toBe("lyft");
    expect(Number(u.searchParams.get("destination[latitude]"))).toBe(33.7);
    expect(Number(u.searchParams.get("destination[longitude]"))).toBe(-84.3);
    expect(u.searchParams.get("destination[address]")).toBe(FAKE_HOME.address);
  });
  it("uber uses the documented /looking?drop[0]=<json> format with coordinates", () => {
    const u = new URL(uberUrl(FAKE_HOME));
    expect(u.origin + u.pathname).toBe("https://m.uber.com/looking");
    const drop = JSON.parse(u.searchParams.get("drop[0]")!);
    expect(drop).toMatchObject({ latitude: 33.7, longitude: -84.3, addressLine2: FAKE_HOME.address });
  });
  it("apple maps gets the address as destination", () => {
    expect(new URL(appleMapsUrl(FAKE_HOME)).searchParams.get("daddr")).toBe(FAKE_HOME.address);
  });
});
