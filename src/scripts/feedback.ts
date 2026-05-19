// Client-side form handling for both feedback surfaces.
// Forms post to the current page path with URL-encoded bodies — Netlify Forms
// detects submissions by the form-name field, not by the path. We avoid POSTing
// to "/" because netlify.toml has a `/` → `/guest` 302 redirect that strips
// the POST body before Netlify Forms ever sees it.

export function faceEmojiToValue(emoji: string): string | null {
  const map: Record<string, string> = {
    "😴": "sleepy",
    "🙂": "smile",
    "😊": "grin",
    "😍": "heart",
    "🤯": "mindblown",
  };
  return map[emoji] ?? null;
}

function encode(data: FormData): string {
  const params = new URLSearchParams();
  for (const [k, v] of data.entries()) {
    params.append(k, String(v));
  }
  return params.toString();
}

async function submit(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const res = await fetch(window.location.pathname, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: encode(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function swapToThanks(form: HTMLFormElement): void {
  const tile = form.closest("[data-feedback-tile]");
  if (tile) {
    tile.innerHTML = `<p class="thanks-text">Thanks — Zach will see it. 💛</p>`;
    tile.classList.add("thanks");
    return;
  }
  // /feedback page: replace the form with a thank-you message
  const main = form.closest("main");
  if (main) {
    main.innerHTML = `
      <section class="hero">
        <h1>Got it — appreciate it.</h1>
        <p class="hero-sub">Zach will see it.</p>
      </section>
      <p class="back"><a href="/guest">← back to portal</a></p>
    `;
  }
}

function showError(form: HTMLFormElement): void {
  const err = form.querySelector<HTMLElement>("[data-feedback-error]");
  if (err) err.hidden = false;
}

function clearError(form: HTMLFormElement): void {
  const err = form.querySelector<HTMLElement>("[data-feedback-error]");
  if (err) err.hidden = true;
}

function wire(form: HTMLFormElement): void {
  // The vibe tile submits on radio change; the long survey submits on button click.
  const isVibeTile = form.getAttribute("name") === "guest-vibe";

  if (isVibeTile) {
    form.querySelectorAll<HTMLInputElement>('input[name="face"]').forEach(input => {
      input.addEventListener("change", async () => {
        try {
          await submit(form);
          swapToThanks(form);
        } catch {
          // Vibe tile has no error slot — re-enable radios and noop. Guest can refresh and retry.
        }
      });
    });
    return;
  }

  // Long survey: standard submit handler.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError(form);
    try {
      await submit(form);
      swapToThanks(form);
    } catch {
      showError(form);
    }
  });
}

if (typeof document !== "undefined") {
  document.querySelectorAll<HTMLFormElement>("[data-feedback-form]").forEach(wire);
}
