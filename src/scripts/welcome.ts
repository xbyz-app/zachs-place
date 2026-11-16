import { greeting } from "../lib/welcome";

export const STAYING_SUB = "You're at Zach's place. Make yourself at home.";

/** Swap the hero to greet whoever is staying. The static HTML is the
 * evergreen welcome, so a failed fetch leaves the page as it was. */
export async function applyWelcome(doc: Pick<Document, "querySelector"> = document, fetcher: typeof fetch = fetch): Promise<boolean> {
  const h1 = doc.querySelector<HTMLElement>("[data-welcome-title]");
  const sub = doc.querySelector<HTMLElement>("[data-welcome-sub]");
  if (!h1 || !sub) return false;
  try {
    const res = await fetcher("/api/welcome", { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as { names?: unknown };
    const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
    const line = greeting(names);
    if (!line) return false;
    h1.textContent = line;
    sub.textContent = STAYING_SUB;
    return true;
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  void applyWelcome();
}
