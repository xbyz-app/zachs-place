import type { HomeVars, RideLinks } from "./types";

// Uber: developer.uber.com deep-links doc (checked 2026-09-12); coordinates win over the address label.
// Lyft: public docs are offline. Format taken from Lyft's SDKs; Task 10 verifies it on a real phone.
export function lyftUrl(h: HomeVars): string {
  const p = new URLSearchParams({
    id: "lyft",
    "destination[latitude]": String(h.lat),
    "destination[longitude]": String(h.lng),
    "destination[address]": h.address,
  });
  return `https://lyft.com/ride?${p.toString()}`;
}

export function uberUrl(h: HomeVars): string {
  const drop = JSON.stringify({ latitude: h.lat, longitude: h.lng, addressLine1: "Zach's place", addressLine2: h.address });
  return `https://m.uber.com/looking?drop[0]=${encodeURIComponent(drop)}`;
}

export function appleMapsUrl(h: HomeVars): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(h.address)}&dirflg=d`;
}

export function rideLinks(h: HomeVars): RideLinks {
  return { lyft: lyftUrl(h), uber: uberUrl(h), appleMaps: appleMapsUrl(h) };
}
