import type { Branch, Step } from "./route";
import type { Concourse, Pickup, RideLinks, RouteInput } from "./types";
import { BRANCH_LABEL, GROUP_TITLES, SMS_COPY, fillTemplate } from "./copy";

export interface StepItem { branch?: Branch; text: string }
export interface StepGroup { group: 1 | 2 | 3 | 4; title: string; items: StepItem[] }
export interface EmailMessage { subject: string; html: string; text: string }

const concourseVars = (c: Concourse | null) => ({ concourse: c ?? "your concourse" });

export function groupSteps(steps: Step[], pickup: Pickup, concourse: Concourse | null, copy: Record<string, string>): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const s of steps) {
    const template = copy[s.id];
    if (template === undefined) throw new Error(`no copy for step ${s.id}`);
    let g = groups[groups.length - 1];
    if (!g || g.group !== s.group) {
      g = { group: s.group, title: GROUP_TITLES[pickup][s.group], items: [] };
      groups.push(g);
    }
    const text = fillTemplate(template, concourseVars(concourse));
    g.items.push(s.branch ? { branch: s.branch, text } : { text });
  }
  return groups;
}

export function renderSms(steps: Step[], pickup: Pickup, concourse: Concourse | null, pageUrl: string): string {
  const withCopy = steps.filter((s) => SMS_COPY[s.id] !== undefined);
  const line = (xs: Step[]) => xs.map((s) => fillTemplate(SMS_COPY[s.id]!, concourseVars(concourse))).join(" ");
  const parts = [line(withCopy.filter((s) => !s.branch))];
  const noBag = withCopy.filter((s) => s.branch === "no-bag");
  const bag = withCopy.filter((s) => s.branch === "bag");
  if (noBag.length) parts.push(`no bag: ${line(noBag)}`);
  if (bag.length) parts.push(`checked bag: ${line(bag)}`);
  const tail = pickup === "rideshare" ? "the rest + the lyft button:" : "the rest:";
  return `you landed!! ${parts.filter(Boolean).join(" ")} ${tail} ${pageUrl}`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const wrap = (inner: string) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#1a1410;font-size:16px;line-height:1.5">${inner}</div>`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:8px 8px 0 0;padding:12px 18px;border-radius:999px;background:#1a1410;color:#f5e6d3;text-decoration:none;font-weight:600">${esc(label)}</a>`;

function groupsHtml(groups: StepGroup[]): string {
  return groups.map((g) => {
    let html = `<h3 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#8a6a4a">${esc(g.title)}</h3><ul style="margin:0;padding-left:20px">`;
    let last: Branch | undefined;
    for (const it of g.items) {
      if (it.branch && it.branch !== last) html += `<li style="list-style:none;margin:12px 0 4px -20px;font-weight:600">${esc(BRANCH_LABEL[it.branch])}:</li>`;
      last = it.branch;
      html += `<li style="margin:6px 0">${esc(it.text)}</li>`;
    }
    return html + "</ul>";
  }).join("");
}

function groupsText(groups: StepGroup[]): string {
  return groups.map((g) => {
    const lines = [g.title.toUpperCase()];
    let last: Branch | undefined;
    for (const it of g.items) {
      if (it.branch && it.branch !== last) lines.push(`${BRANCH_LABEL[it.branch]}:`);
      last = it.branch;
      lines.push(`- ${it.text}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

const callLine = (phone: string | null) =>
  phone ? `call me if anything goes sideways, ringer's on: ${phone}` : "call me if anything goes sideways, ringer's on.";

export interface LandedEmailArgs {
  firstName: string; steps: Step[]; input: RouteInput; copy: Record<string, string>;
  pageUrl: string; links: RideLinks; zachPhone: string | null;
}

export function renderLandedEmail(a: LandedEmailArgs): EmailMessage {
  const groups = groupSteps(a.steps, a.input.pickup, a.input.concourse, a.copy);
  const where = a.input.international === true ? "you landed, welcome in!!"
    : a.input.concourse ? `you landed in ${a.input.concourse}!!` : "you landed!!";
  const intro = `${where} here's exactly what to do, one step at a time. it's all on your page too:`;
  const ride = a.input.pickup === "rideshare";
  const html = wrap(
    `<p>hi ${esc(a.firstName)}!</p><p>${esc(intro)} <a href="${esc(a.pageUrl)}">${esc(a.pageUrl)}</a></p>` +
    (ride ? `<p>${button(a.links.lyft, "open lyft")}${button(a.links.uber, "open uber")}</p>` : "") +
    groupsHtml(groups) +
    `<p style="margin-top:24px">${esc(callLine(a.zachPhone))}</p><p>zach</p>`,
  );
  const text = [
    `hi ${a.firstName}!`, `${intro} ${a.pageUrl}`,
    ...(ride ? [`lyft: ${a.links.lyft}\nuber: ${a.links.uber}`] : []),
    groupsText(groups), callLine(a.zachPhone), "zach",
  ].join("\n\n");
  return { subject: "you landed!! here's how to get to me", html, text };
}

export interface PreArrivalArgs {
  firstName: string; arriveDate: string; flightNumber: string | null; checkedBag: boolean | null;
  pickup: Pickup; pageUrl: string; address: string; zachPhone: string | null;
}

export function renderPreArrivalEmail(a: PreArrivalArgs): EmailMessage {
  const day = new Date(`${a.arriveDate}T12:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .toLowerCase();
  const paras: string[] = [
    `hi ${a.firstName}! ok so you don't have to think when you land on ${day}, here's how it goes.`,
    `the second ${a.flightNumber ? a.flightNumber : "your flight"} lands i'll text + email you exact steps from your gate: where to go, which way to turn, where to get your ride. it's all on your page too, and it updates live: ${a.pageUrl}`,
    a.pickup === "rideshare"
      ? `plan on a lyft to my place (${a.address}), it's usually way cheaper than uber from the airport. your page has a button that opens lyft with my address already in.`
      : "i'm picking you up!! once you're off the plane just head for the arrivals curb and text me your door number.",
    ...(a.checkedBag === null ? ["let me know if you're checking a bag, it changes which way you turn at the top of the escalators."] : []),
    "you'll get an invite from an app called Door. download it and make an account before you fly, it's what unlocks my door. when you get to the building the concierge will send you up in the elevator.",
    callLine(a.zachPhone),
    "zach",
  ];
  const html = wrap(paras.map((p) => {
    const linked = esc(p).replace(esc(a.pageUrl), `<a href="${esc(a.pageUrl)}">${esc(a.pageUrl)}</a>`);
    return `<p>${linked}</p>`;
  }).join(""));
  return { subject: "your atlanta landing plan (so you don't have to think)", html, text: paras.join("\n\n") };
}
