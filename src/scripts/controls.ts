type State = {
  tv_bars: { state: "on" | "off"; brightness: number | null; rgb_color: [number, number, number] | null };
  sonos: { volume_level: number | null };
  live_nudes: { state: "on" | "off" };
  lava_lamp: { state: "on" | "off" };
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

  const vol = document.querySelector<HTMLElement>('[data-tile="sonos"]');
  if (vol && state.sonos.volume_level !== null) {
    const pct = Math.round(state.sonos.volume_level * 100);
    const slider = vol.querySelector<HTMLInputElement>('[data-action="volume"]');
    if (slider) slider.value = String(pct);
    const display = vol.querySelector<HTMLElement>('[data-display="pct"]');
    if (display) display.textContent = `${pct}%`;
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

loadInitialState();
wireToggleTiles();
wireTVTile();
wireVolumeTile();
