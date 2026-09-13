import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { homeFromEnv } from "../../src/server/guests/home";
import { sendEmail } from "../../src/server/guests/email";
import { sendSms } from "../../src/server/guests/sms";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { applyFakeEnv, FAKE_ENV } from "../helpers/env";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { applyFakeEnv(); });
afterEach(() => { global.fetch = ORIGINAL_FETCH; process.env = { ...ORIGINAL_ENV }; });

const mockFetch = (res: unknown) => { const f = vi.fn().mockResolvedValue(res); global.fetch = f as unknown as typeof fetch; return f; };

describe("homeFromEnv", () => {
  it("reads every HOME_* var and parses coordinates", () => {
    const r = homeFromEnv();
    expect(r).toEqual({ ok: true, home: { address: FAKE_ENV.HOME_ADDRESS, lat: 33.7, lng: -84.3, street: "test", crossStreet: "99th", unit: "7Q", unitLetter: "Q", floor: "7" } });
  });
  it("names every missing or bad var", () => {
    delete process.env.HOME_UNIT; process.env.HOME_LAT = "north-ish";
    const r = homeFromEnv();
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("HOME_UNIT"); expect(r.error).toContain("HOME_LAT"); }
  });
});

describe("sendEmail", () => {
  beforeEach(() => { process.env.RESEND_API_KEY = "re_x"; process.env.GUEST_EMAIL_FROM = "Zach <zach@example.test>"; process.env.ZACH_REPLY_TO = "zach@example.test"; });
  it("posts to Resend with from, reply_to and both bodies", async () => {
    const f = mockFetch({ ok: true, status: 200, json: async () => ({ id: "em_1" }) });
    expect(await sendEmail({ to: "g@example.test", subject: "s", html: "<p>h</p>", text: "h" })).toEqual({ ok: true, id: "em_1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_x");
    expect(JSON.parse(init.body)).toEqual({ from: "Zach <zach@example.test>", to: ["g@example.test"], subject: "s", html: "<p>h</p>", text: "h", reply_to: "zach@example.test" });
  });
  it("returns errors instead of throwing", async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ message: "bad from" }) });
    expect(await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).toEqual({ ok: false, error: "resend 422: bad from" });
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    expect((await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).ok).toBe(false);
    delete process.env.RESEND_API_KEY;
    expect((await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).ok).toBe(false);
  });
});

describe("sendSms", () => {
  beforeEach(() => { process.env.TWILIO_ACCOUNT_SID = "AC1"; process.env.TWILIO_AUTH_TOKEN = "t"; process.env.TWILIO_FROM_NUMBER = "+15555550199"; });
  it("is skipped, not failed, unless GUEST_SMS_ENABLED is exactly 'true'", async () => {
    const f = mockFetch({ ok: true });
    for (const v of [undefined, "1", "yes", "TRUE"]) {
      if (v === undefined) delete process.env.GUEST_SMS_ENABLED; else process.env.GUEST_SMS_ENABLED = v;
      expect(await sendSms({ to: "+15555550111", body: "hi" })).toMatchObject({ ok: false, skipped: true });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("posts form-encoded to Twilio with basic auth when enabled", async () => {
    process.env.GUEST_SMS_ENABLED = "true";
    const f = mockFetch({ ok: true, status: 201, json: async () => ({ sid: "SM1" }) });
    expect(await sendSms({ to: "+15555550111", body: "hi there" })).toEqual({ ok: true, id: "SM1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("AC1:t").toString("base64"));
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ From: "+15555550199", To: "+15555550111", Body: "hi there" });
  });
  it("returns Twilio errors instead of throwing", async () => {
    process.env.GUEST_SMS_ENABLED = "true";
    mockFetch({ ok: false, status: 400, json: async () => ({ message: "unregistered number" }) });
    expect(await sendSms({ to: "+15555550111", body: "x" })).toEqual({ ok: false, error: "twilio 400: unregistered number" });
  });
});

describe("sendNtfy", () => {
  beforeEach(() => { process.env.NTFY_TOPIC = "zach-guests-test"; });
  it("posts the body, keeps headers ASCII even with fancy title text", async () => {
    const f = mockFetch({ ok: true, status: 200 });
    expect(await sendNtfy({ title: "Shiner landed — T5 ✈", body: "body — with unicode ✓", click: "https://guest.example.test/arrive/x", priority: "high" })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/zach-guests-test");
    expect(init.body).toBe("body — with unicode ✓");
    for (const v of Object.values(init.headers as Record<string, string>)) expect(v).toMatch(/^[\x20-\x7E]*$/);
    expect(init.headers.Title).toBe("Shiner landed - T5 ?");
    expect(init.headers.Priority).toBe("high");
  });
  it("never throws: missing topic, non-2xx, network error", async () => {
    delete process.env.NTFY_TOPIC;
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
    process.env.NTFY_TOPIC = "x";
    mockFetch({ ok: false, status: 500 });
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
  });
  it("never throws on malformed click URL (unpaired UTF-16 surrogate)", async () => {
    const f = mockFetch({ ok: true });
    const result = await sendNtfy({ title: "t", body: "b", click: "https://x.test/\uD800" });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(f).not.toHaveBeenCalled();
  });
});
