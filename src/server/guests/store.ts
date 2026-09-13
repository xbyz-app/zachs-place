import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Guest } from "../../lib/arrival/types";

export interface GuestStore {
  get(id: string): Promise<Guest | null>;
  put(guest: Guest): Promise<void>;
  list(): Promise<Guest[]>;
  remove(id: string): Promise<void>;
}

export interface CounterStore {
  get(key: string): Promise<number>;
  increment(key: string): Promise<number>;
}

export function blobGuestStore(): GuestStore {
  const store = getStore({ name: "guests", consistency: "strong" });
  return {
    async get(id) { return ((await store.get(id, { type: "json" })) as Guest | null) ?? null; },
    async put(g) { await store.setJSON(g.id, g); },
    async list() {
      const { blobs } = await store.list();
      const out: Guest[] = [];
      for (const b of blobs) {
        const g = (await store.get(b.key, { type: "json" })) as Guest | null;
        if (g) out.push(g);
      }
      return out;
    },
    async remove(id) { await store.delete(id); },
  };
}

export function blobCounterStore(): CounterStore {
  const store = getStore({ name: "counters", consistency: "strong" });
  const get = async (key: string) => {
    const v = await store.get(key, { type: "json" });
    return typeof v === "number" ? v : 0;
  };
  return {
    get,
    async increment(key) { const n = (await get(key)) + 1; await store.setJSON(key, n); return n; },
  };
}

export function memoryGuestStore(seed: Guest[] = []): GuestStore {
  const m = new Map(seed.map((g) => [g.id, structuredClone(g)]));
  return {
    async get(id) { const g = m.get(id); return g ? structuredClone(g) : null; },
    async put(g) { m.set(g.id, structuredClone(g)); },
    async list() { return [...m.values()].map((g) => structuredClone(g)); },
    async remove(id) { m.delete(id); },
  };
}

export function memoryCounterStore(): CounterStore {
  const m = new Map<string, number>();
  return {
    async get(k) { return m.get(k) ?? 0; },
    async increment(k) { const n = (m.get(k) ?? 0) + 1; m.set(k, n); return n; },
  };
}

export async function findByToken(store: GuestStore, token: string): Promise<Guest | null> {
  if (!token || token.length < 20) return null;
  const want = Buffer.from(token);
  for (const g of await store.list()) {
    const have = Buffer.from(g.token);
    if (have.length === want.length && timingSafeEqual(have, want)) return g;
  }
  return null;
}
