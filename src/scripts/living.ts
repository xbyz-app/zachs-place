// Living room light chips on the guest page. Reads and writes /api/living,
// which routes every tap through Pat's own scripts (see
// netlify/functions/living.ts).

type Action = "low" | "normal" | "bright" | "chill" | "off";

function tile(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-living]");
}

function render(active: Action | null) {
  const el = tile();
  if (!el) return;
  el.dataset.on = String(active !== null && active !== "off");
  el.querySelectorAll<HTMLButtonElement>("[data-living-action]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.livingAction === active));
  });
}

function setOffline(offline: boolean) {
  const el = tile();
  if (!el) return;
  el.dataset.offline = String(offline);
  const note = el.querySelector<HTMLElement>("[data-living-offline]");
  if (note) note.hidden = !offline;
}

async function load() {
  try {
    const res = await fetch("/api/living");
    if (!res.ok) throw new Error(String(res.status));
    const { active } = (await res.json()) as { active: Action | null };
    setOffline(false);
    render(active);
  } catch {
    setOffline(true);
  }
}

function wire() {
  const el = tile();
  if (!el) return;
  el.querySelectorAll<HTMLButtonElement>("[data-living-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.livingAction as Action;
      const before = el.querySelector<HTMLButtonElement>('[data-living-action][aria-pressed="true"]')
        ?.dataset.livingAction as Action | undefined;
      render(action);
      btn.dataset.busy = "true";
      try {
        const res = await fetch("/api/living", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        if (!res.ok) throw new Error(String(res.status));
        setOffline(false);
      } catch {
        render(before ?? null);
        setOffline(true);
      } finally {
        delete btn.dataset.busy;
      }
    });
  });
}

if (typeof document !== "undefined") {
  load();
  wire();
}
