import { describe, it, expect } from "vitest";
import { applyWelcome, STAYING_SUB } from "../../src/scripts/welcome";

function fakeDoc() {
  const h1 = { textContent: "You're at Zach's place." };
  const sub = { textContent: "Welcome — make yourself at home." };
  const doc = { querySelector: (sel: string) => (sel === "[data-welcome-title]" ? h1 : sel === "[data-welcome-sub]" ? sub : null) };
  return { doc: doc as unknown as Pick<Document, "querySelector">, h1, sub };
}
const respond = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("applyWelcome", () => {
  it("greets whoever is staying", async () => {
    const { doc, h1, sub } = fakeDoc();
    expect(await applyWelcome(doc, respond({ names: ["Shiner"] }))).toBe(true);
    expect(h1.textContent).toBe("Welcome, Shiner.");
    expect(sub.textContent).toBe(STAYING_SUB);
  });

  it("leaves the evergreen welcome alone with nobody staying, a bad answer or no network", async () => {
    for (const fetcher of [respond({ names: [] }), respond({ names: [42] }), respond({}, false), (async () => { throw new Error("offline"); }) as unknown as typeof fetch]) {
      const { doc, h1, sub } = fakeDoc();
      expect(await applyWelcome(doc, fetcher)).toBe(false);
      expect(h1.textContent).toBe("You're at Zach's place.");
      expect(sub.textContent).toBe("Welcome — make yourself at home.");
    }
  });
});
