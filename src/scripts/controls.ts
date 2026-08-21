type State = {
  tv_bars: { state: "on" | "off"; brightness: number | null; rgb_color: [number, number, number] | null };
  ig_logo: { state: "on" | "off"; rgb_color: [number, number, number] | null };
  sonos: { volume_level: number | null };
  live_nudes: { state: "on" | "off" };
  lava_lamp: { state: "on" | "off" };
};

const IG_MODES: Record<"pink" | "white", [number, number, number]> = {
  pink:  [255, 0, 105],
  white: [220, 230, 255]
};

const DEBOUNCE_MS = 200;

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...args: any[]) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** How the Speaker tile should render for a given HA volume_level.
 *
 * `null` means the office Sonos is unavailable to HA — the speaker is off the
 * network, not at zero volume. That distinction is the whole reason this
 * exists: `/api/volume` posts to HA, HA no-ops a write to an unavailable
 * entity, and the function returns `{"ok":true}` regardless. So the old
 * "skip rendering when null" branch left a live-looking slider parked at 0%
 * that a guest could drag all evening with no sound and no error. Marking the
 * tile offline is what makes the failure visible; the CSS on
 * `[data-offline="true"]` dims it and takes pointer events away.
 *
 * Exported for the test — controls.ts wires the DOM on import, so this is the
 * seam that can be asserted without a browser.
 */
export function speakerTile(volume: number | null): {
  offline: boolean;
  pct: number;
  display: string;
} {
  if (volume === null) return { offline: true, pct: 0, display: "Offline" };
  const pct = Math.round(volume * 100);
  return { offline: false, pct, display: `${pct}%` };
}

function setOffline(offline: boolean) {
  document.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => {
    el.dataset.offline = String(offline);
  });
  const banner = document.getElementById("offline-banner");
  if (banner) banner.hidden = !offline;
}

function renderState(state: State) {
  const tv = document.querySelector<HTMLElement>('[data-tile="tv_bars"]');
  if (tv) {
    const isOn = state.tv_bars.state === "on";
    tv.dataset.on = String(isOn);
    const power = tv.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    if (power) power.setAttribute("aria-pressed", String(isOn));
    const slider = tv.querySelector<HTMLInputElement>('[data-action="brightness"]');
    if (slider) slider.value = String(isOn && state.tv_bars.brightness ? state.tv_bars.brightness : 0);
    const rgb = state.tv_bars.rgb_color;
    tv.querySelectorAll<HTMLElement>('[data-action="color"]').forEach((dot) => {
      const dotRgb = dot.dataset.rgb?.split(",").map(Number) ?? [];
      const match = rgb && rgb[0] === dotRgb[0] && rgb[1] === dotRgb[1] && rgb[2] === dotRgb[2];
      dot.setAttribute("aria-pressed", String(Boolean(match)));
    });
  }

  const ig = document.querySelector<HTMLElement>('[data-tile="ig_logo"]');
  if (ig) {
    const isOn = state.ig_logo.state === "on";
    ig.dataset.on = String(isOn);
    const rgb = state.ig_logo.rgb_color;
    const activeMode = !isOn
      ? "off"
      : rgb && rgb[0] === IG_MODES.pink[0] && rgb[1] === IG_MODES.pink[1] && rgb[2] === IG_MODES.pink[2]
        ? "pink"
        : rgb && rgb[0] === IG_MODES.white[0] && rgb[1] === IG_MODES.white[1] && rgb[2] === IG_MODES.white[2]
          ? "white"
          : null;
    ig.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === activeMode));
    });
  }

  const vol = document.querySelector<HTMLElement>('[data-tile="sonos"]');
  if (vol) {
    const speaker = speakerTile(state.sonos.volume_level);
    vol.dataset.offline = String(speaker.offline);
    const slider = vol.querySelector<HTMLInputElement>('[data-action="volume"]');
    if (slider) slider.value = String(speaker.pct);
    const display = vol.querySelector<HTMLElement>('[data-display="pct"]');
    if (display) display.textContent = speaker.display;
  }

  (["live_nudes", "lava_lamp"] as const).forEach((key) => {
    const tile = document.querySelector<HTMLButtonElement>(`[data-tile="${key}"]`);
    if (tile) tile.setAttribute("aria-pressed", String(state[key].state === "on"));
  });
}

async function loadInitialState() {
  try {
    const state = await api<State>("/api/state");
    setOffline(false);
    renderState(state);
  } catch {
    setOffline(true);
  }
}

function wireToggleTiles() {
  document.querySelectorAll<HTMLButtonElement>('button.toggle-tile').forEach((tile) => {
    tile.addEventListener("click", async () => {
      const entity = tile.dataset.entity as "live_nudes" | "lava_lamp";
      const wasOn = tile.getAttribute("aria-pressed") === "true";
      const next = wasOn ? "off" : "on";
      tile.setAttribute("aria-pressed", String(!wasOn));
      try {
        await api("/api/switch", { entity, state: next });
      } catch {
        tile.setAttribute("aria-pressed", String(wasOn));
        setOffline(true);
      }
    });
  });
}

function wireTVTile() {
  const tile = document.querySelector<HTMLElement>('[data-tile="tv_bars"]');
  if (!tile) return;

  const power = tile.querySelector<HTMLButtonElement>('[data-action="toggle"]');
  power?.addEventListener("click", async () => {
    const isOn = tile.dataset.on === "true";
    const next = isOn ? "off" : "on";
    tile.dataset.on = String(!isOn);
    power.setAttribute("aria-pressed", String(!isOn));
    try {
      await api("/api/light", { entity: "tv_bars", state: next });
    } catch {
      tile.dataset.on = String(isOn);
      power.setAttribute("aria-pressed", String(isOn));
      setOffline(true);
    }
  });

  const slider = tile.querySelector<HTMLInputElement>('[data-action="brightness"]');
  const sendBrightness = debounce(async (val: number) => {
    try {
      await api("/api/light", { entity: "tv_bars", brightness: val });
      tile.dataset.on = "true";
      power?.setAttribute("aria-pressed", "true");
    } catch {
      setOffline(true);
    }
  }, DEBOUNCE_MS);
  slider?.addEventListener("input", () => {
    const val = parseInt(slider.value, 10);
    sendBrightness(val);
  });

  tile.querySelectorAll<HTMLElement>('[data-action="color"]').forEach((dot) => {
    dot.addEventListener("click", async () => {
      const rgb = (dot.dataset.rgb ?? "").split(",").map(Number) as [number, number, number];
      tile.querySelectorAll<HTMLElement>('[data-action="color"]').forEach((d) => d.setAttribute("aria-pressed", "false"));
      dot.setAttribute("aria-pressed", "true");
      try {
        await api("/api/light", { entity: "tv_bars", rgb_color: rgb });
      } catch {
        setOffline(true);
      }
    });
  });
}

function wireVolumeTile() {
  const tile = document.querySelector<HTMLElement>('[data-tile="sonos"]');
  if (!tile) return;
  const slider = tile.querySelector<HTMLInputElement>('[data-action="volume"]');
  const display = tile.querySelector<HTMLElement>('[data-display="pct"]');

  const send = debounce(async (vol: number) => {
    try {
      await api("/api/volume", { volume: vol });
    } catch {
      setOffline(true);
    }
  }, DEBOUNCE_MS);

  slider?.addEventListener("input", () => {
    const pct = parseInt(slider.value, 10);
    if (display) display.textContent = `${pct}%`;
    send(pct / 100);
  });
}

function wireIGLogoTile() {
  const tile = document.querySelector<HTMLElement>('[data-tile="ig_logo"]');
  if (!tile) return;

  tile.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.mode as "off" | "pink" | "white";
      tile.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      });
      tile.dataset.on = String(mode !== "off");

      const payload: Record<string, unknown> = { entity: "ig_logo" };
      if (mode === "off") {
        payload.state = "off";
      } else {
        payload.rgb_color = IG_MODES[mode];
        payload.brightness = 255;
      }

      try {
        await api("/api/light", payload);
      } catch {
        setOffline(true);
      }
    });
  });
}

// Browser entry point. Guarded so the module can be imported for its pure
// helpers (speakerTile) under vitest, whose default environment is node and
// has no document — without the guard, importing this file to test one
// function runs the whole DOM wiring and throws.
if (typeof document !== "undefined") {
  loadInitialState();
  wireToggleTiles();
  wireTVTile();
  wireIGLogoTile();
  wireVolumeTile();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration failed", err);
      });
    });
  }
}
