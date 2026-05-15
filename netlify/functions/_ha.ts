export const ENTITY_ALLOWLIST = [
  "light.office_tv_light_bars",
  "light.ig_logo",
  "switch.live_nudes",
  "switch.lava_lamp",
  "media_player.zachs_office"
] as const;

export type AllowedEntity = typeof ENTITY_ALLOWLIST[number];

export function isAllowed(entity: string): entity is AllowedEntity {
  return (ENTITY_ALLOWLIST as readonly string[]).includes(entity);
}

interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

export async function callHA(path: string, opts: CallOptions = {}): Promise<unknown> {
  const baseUrl = process.env.HA_BASE_URL;
  const token = process.env.HA_GUEST_TOKEN;
  if (!baseUrl) throw new Error("HA_BASE_URL not set");
  if (!token) throw new Error("HA_GUEST_TOKEN not set");

  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (method === "POST") headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  } catch (err) {
    throw new Error(`HA unreachable: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HA unreachable: ${res.status} ${text}`);
  }

  return res.json();
}
