import { buildRoute } from "../lib/arrival/route";
import { groupSteps } from "../lib/arrival/render";
import { BRANCH_LABEL } from "../lib/arrival/copy";
import { CONCOURSES, type Concourse, type PageModel } from "../lib/arrival/types";
import { shouldRefresh, statusLine, tokenFromPath } from "../lib/arrival/page";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const token = tokenFromPath(location.pathname);
const CACHE_KEY = token ? `arrive:${token}` : "";
let model: PageModel | null = null;
let override: Concourse | null | undefined; // undefined = trust tracking

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function gone(title: string, text: string) {
  $("loading").hidden = true;
  $("page").hidden = true;
  $("gone").hidden = false;
  $("gone-title").textContent = title;
  $("gone-text").textContent = text;
}

function renderSteps() {
  if (!model) return;
  const concourse = override !== undefined ? override : model.route.concourse;
  const input = { ...model.route, concourse };
  const root = $("steps");
  root.replaceChildren();
  for (const g of groupSteps(buildRoute(input), input.pickup, concourse, model.copy)) {
    const card = el("section", "card");
    card.append(el("h2", "section-title", g.title));
    const list = el("ol", "step-list");
    let last: string | undefined;
    for (const item of g.items) {
      if (item.branch && item.branch !== last) list.append(el("li", "branch", BRANCH_LABEL[item.branch]));
      last = item.branch;
      list.append(el("li", undefined, item.text));
    }
    card.append(list);
    root.append(card);
  }
  $("where").hidden = input.international === true;
  for (const b of $("picker").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String((b.dataset.c || null) === concourse));
  }
}

function paint() {
  const m = model!;
  $("loading").hidden = true;
  $("gone").hidden = true;
  $("page").hidden = false;
  $("hello").textContent = `welcome, ${m.firstName}.`;
  $("status").textContent = statusLine(m.flight);
  const ride = m.route.pickup === "rideshare";
  $("ride").hidden = !ride;
  if (ride) {
    $<HTMLAnchorElement>("lyft").href = m.links.lyft;
    $<HTMLAnchorElement>("uber").href = m.links.uber;
    $("address").textContent = m.address;
  }
  const call = $<HTMLAnchorElement>("call");
  call.hidden = !m.zachPhone;
  if (m.zachPhone) call.href = `tel:${m.zachPhone}`;
  renderSteps();
}

async function load(first: boolean) {
  if (!token) return gone("this link doesn't look right", "text zach for a fresh link.");
  let res: Response;
  try {
    res = await fetch(`/api/arrive?token=${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    if (first && !model) return gone("no signal right now", "your steps load once you're back online. or just call zach.");
    return;
  }
  if (res.status === 404) return gone("this link doesn't work", "text zach for a fresh one.");
  if (res.status === 410) { try { localStorage.removeItem(CACHE_KEY); } catch {} return gone("this visit's over", "hope it was a good one!!"); }
  if (!res.ok) { if (first && !model) gone("something broke", "call zach, ringer's on."); return; }
  model = (await res.json()) as PageModel;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(model)); } catch {}
  paint();
}

// Picker
for (const c of [...CONCOURSES, null] as (Concourse | null)[]) {
  const b = el("button", undefined, c ?? "not sure");
  b.type = "button";
  b.dataset.c = c ?? "";
  b.addEventListener("click", () => { override = c; renderSteps(); });
  $("picker").append(b);
}

// Copy address
$("copy").addEventListener("click", async () => {
  if (!model) return;
  const btn = $("copy");
  try { await navigator.clipboard.writeText(model.address); btn.textContent = "copied!"; }
  catch { btn.textContent = "long-press the address below to copy"; }
});

// Airports have bad signal: paint the last good copy first, then refresh.
try {
  const cached = CACHE_KEY && localStorage.getItem(CACHE_KEY);
  if (cached) { model = JSON.parse(cached) as PageModel; paint(); }
} catch {}
void load(true);
setInterval(() => {
  if (document.visibilityState === "visible" && model && shouldRefresh(model.flight)) void load(false);
}, 60_000);
