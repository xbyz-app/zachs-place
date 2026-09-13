import type { HomeVars } from "../../src/lib/arrival/types";

// FAKE values only. This repo is public; real home details live in Netlify env.
export const FAKE_ENV: Record<string, string> = {
  HOME_ADDRESS: "100 Test Ave NW, Atlanta, GA 30300",
  HOME_LAT: "33.7000000",
  HOME_LNG: "-84.3000000",
  HOME_STREET: "test",
  HOME_CROSS_STREET: "99th",
  HOME_UNIT: "7Q",
  HOME_UNIT_LETTER: "Q",
  HOME_FLOOR: "7",
  ZACH_PHONE: "+15555550100",
  SITE_URL: "https://guest.example.test",
};
export function applyFakeEnv(): void { Object.assign(process.env, FAKE_ENV); }

export const FAKE_HOME: HomeVars = {
  address: FAKE_ENV.HOME_ADDRESS, lat: 33.7, lng: -84.3,
  street: "test", crossStreet: "99th", unit: "7Q", unitLetter: "Q", floor: "7",
};
