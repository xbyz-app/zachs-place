import { emptyTracking, type Guest } from "../../src/lib/arrival/types";

export function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: "testy-abc123",
    token: "tok_" + "x".repeat(40),
    name: "Testy McTest",
    firstName: "Testy",
    email: "testy@example.test",
    phone: "+15555550111",
    arriveDate: "2026-09-20",
    departDate: "2026-09-23",
    flight: { number: "DL1234", date: "2026-09-20" },
    checkedBag: false,
    pickup: "rideshare",
    doorInvited: true,
    buildingRegistered: false,
    tracking: emptyTracking(),
    sends: {},
    alertsSent: [],
    createdAt: "2026-09-10T15:00:00.000Z",
    ...overrides,
  };
}
