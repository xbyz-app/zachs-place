#!/usr/bin/env node
// Local editor for the guest manual. Reads and writes src/content/manual/*.md directly.
// Run: npm run manual   →   http://localhost:4399
import { createServer } from "node:http";
import { readFile, writeFile, readdir, unlink, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANUAL_DIR = process.env.MANUAL_DIR || join(ROOT, "src/content/manual");
const ICON_FILE = join(ROOT, "src/components/Icon.astro");
const PAGE = join(ROOT, "tools/manual-editor.html");
const PORT = Number(process.env.PORT || 4399);

const FILE_RE = /^[a-z0-9][a-z0-9-]*\.md$/;
const safe = (name) => FILE_RE.test(name) && !name.includes("..");

function parse(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (kv) data[kv[1]] = kv[2].replace(/^["'](.*)["']$/, "$1");
    }
  }
  return { data, body: body.replace(/^\r?\n/, "").replace(/\s*$/, "") };
}

function serialize({ title, icon, order, body }) {
  const q = (s) => (/[:#"']/.test(s) ? JSON.stringify(s) : s);
  return `---\ntitle: ${q(title)}\nicon: ${q(icon)}\norder: ${order}\n---\n\n${body.replace(/\s*$/, "")}\n`;
}

async function loadSections() {
  const files = (await readdir(MANUAL_DIR)).filter((f) => f.endsWith(".md")).sort();
  const secs = [];
  for (const file of files) {
    const { data, body } = parse(await readFile(join(MANUAL_DIR, file), "utf8"));
    secs.push({
      file,
      title: data.title ?? file.replace(/\.md$/, ""),
      icon: data.icon ?? "heart",
      order: Number(data.order ?? 999),
      body,
    });
  }
  return secs.sort((a, b) => a.order - b.order);
}

async function loadIcons() {
  const src = await readFile(ICON_FILE, "utf8");
  const icons = {};
  for (const m of src.matchAll(/"([a-z0-9-]+)":\s*`([\s\S]*?)`/g)) icons[m[1]] = m[2];
  return icons;
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "section";
}

// Renumber every file so filename prefix and `order:` both match list position.
async function writeOrder(order) {
  const current = await loadSections();
  const byFile = new Map(current.map((s) => [s.file, s]));
  const staged = [];
  order.forEach((file, i) => {
    const sec = byFile.get(file);
    if (!sec) throw new Error(`unknown file: ${file}`);
    const n = i + 1;
    staged.push({ sec, n, target: `${String(n).padStart(2, "0")}-${sec.file.replace(/^\d+-/, "").replace(/\.md$/, "")}.md` });
  });
  // Two-phase rename so swaps never collide.
  for (const s of staged) {
    if (s.sec.file !== s.target) await rename(join(MANUAL_DIR, s.sec.file), join(MANUAL_DIR, `.tmp-${s.target}`));
  }
  for (const s of staged) {
    const from = s.sec.file !== s.target ? `.tmp-${s.target}` : s.sec.file;
    if (from !== s.target) await rename(join(MANUAL_DIR, from), join(MANUAL_DIR, s.target));
    await writeFile(join(MANUAL_DIR, s.target), serialize({ ...s.sec, order: s.n }), "utf8");
  }
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const body = (req) =>
  new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1e6) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(await readFile(PAGE));
    }

    if (req.method === "GET" && path === "/api/sections") {
      return json(res, 200, { sections: await loadSections(), icons: await loadIcons() });
    }

    if (req.method === "POST" && path === "/api/sections") {
      const { title } = await body(req);
      if (!title || !title.trim()) return json(res, 400, { error: "title required" });
      const secs = await loadSections();
      const n = secs.length + 1;
      const file = `${String(n).padStart(2, "0")}-${slug(title)}.md`;
      if (!safe(file)) return json(res, 400, { error: "bad filename" });
      await writeFile(join(MANUAL_DIR, file), serialize({ title: title.trim(), icon: "heart", order: n, body: "Write the section here." }), "utf8");
      return json(res, 200, { file, sections: await loadSections() });
    }

    const one = path.match(/^\/api\/sections\/(.+)$/);
    if (one) {
      const file = decodeURIComponent(one[1]);
      if (!safe(file)) return json(res, 400, { error: "bad filename" });
      const target = join(MANUAL_DIR, file);

      if (req.method === "PUT") {
        const { title, icon, order, body: md } = await body(req);
        if (!title || !icon) return json(res, 400, { error: "title and icon required" });
        const icons = await loadIcons();
        if (!icons[icon]) return json(res, 400, { error: `no such icon: ${icon}` });
        const existing = parse(await readFile(target, "utf8"));
        await writeFile(target, serialize({ title, icon, order: Number(order ?? existing.data.order ?? 999), body: md ?? "" }), "utf8");
        console.log(`saved ${file}`);
        return json(res, 200, { ok: true, sections: await loadSections() });
      }

      if (req.method === "DELETE") {
        await unlink(target);
        console.log(`deleted ${file}`);
        return json(res, 200, { ok: true, sections: await loadSections() });
      }
    }

    if (req.method === "POST" && path === "/api/reorder") {
      const { order } = await body(req);
      if (!Array.isArray(order) || !order.every(safe)) return json(res, 400, { error: "bad order" });
      await writeOrder(order);
      console.log("reordered");
      return json(res, 200, { sections: await loadSections() });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Guest manual editor → ${url}`);
  console.log(`Editing ${MANUAL_DIR}`);
  if (process.platform === "darwin" && !process.env.NO_OPEN) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
});
