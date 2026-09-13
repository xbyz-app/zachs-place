import type { HomeVars } from "../../lib/arrival/types";

export function homeFromEnv(): { ok: true; home: HomeVars } | { ok: false; error: string } {
  const e = process.env;
  const missing = ["HOME_ADDRESS", "HOME_STREET", "HOME_CROSS_STREET", "HOME_UNIT", "HOME_UNIT_LETTER", "HOME_FLOOR"]
    .filter((k) => !e[k]?.trim());
  const lat = Number(e.HOME_LAT);
  const lng = Number(e.HOME_LNG);
  if (!e.HOME_LAT || !Number.isFinite(lat)) missing.push("HOME_LAT");
  if (!e.HOME_LNG || !Number.isFinite(lng)) missing.push("HOME_LNG");
  if (missing.length) return { ok: false, error: `home config missing/invalid: ${missing.join(", ")}` };
  return {
    ok: true,
    home: {
      address: e.HOME_ADDRESS!, lat, lng, street: e.HOME_STREET!, crossStreet: e.HOME_CROSS_STREET!,
      unit: e.HOME_UNIT!, unitLetter: e.HOME_UNIT_LETTER!, floor: e.HOME_FLOOR!,
    },
  };
}
