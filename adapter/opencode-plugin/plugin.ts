import type { Plugin } from "@opencode-ai/plugin";
import type { ParseWarning } from "../../src/model";

export const DEFAULT_REFRESH_PORT = 4499;

export interface AdapterConfig {
  port?: number;
  host?: string;
  fetchImpl?: typeof fetch;
}

// Loose, testable stand-in for opencode's fully-typed `Event` union. Kept local
// so the pure helpers unit-test without constructing an SDK `Event`; the real
// `file.watcher.updated` carries `properties.file`, but we read file/path/filename
// defensively in case the event shape shifts across opencode versions.
export type OpencodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
};

const PLAN_PATH_RE = /(^|\/)\.sisyphus\/plans\/[^/]+\.md$/;
const BOULDER_PATH_RE = /(^|\/)\.sisyphus\/boulder\.json$/;

export function isWatchedPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  const normalized = path.replace(/\\/g, "/");
  return PLAN_PATH_RE.test(normalized) || BOULDER_PATH_RE.test(normalized);
}

export function extractChangedPath(event: OpencodeEvent): string | undefined {
  if (!event || event.type !== "file.watcher.updated") return undefined;
  const props = event.properties;
  if (!props || typeof props !== "object") return undefined;
  const candidates = ["file", "path", "filename"] as const;
  for (const key of candidates) {
    const value = props[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function refreshUrl(config?: AdapterConfig): string {
  const host = config?.host ?? "127.0.0.1";
  const port = config?.port ?? DEFAULT_REFRESH_PORT;
  return `http://${host}:${port}/refresh`;
}

export async function postRefresh(config?: AdapterConfig): Promise<boolean> {
  const doFetch = config?.fetchImpl ?? fetch;
  try {
    const res = await doFetch(refreshUrl(config), { method: "POST" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export async function handleEvent(
  event: OpencodeEvent,
  config?: AdapterConfig,
): Promise<boolean> {
  const path = extractChangedPath(event);
  if (path === undefined) return false;
  if (!isWatchedPath(path)) return false;
  await postRefresh(config);
  return true;
}

export function createPlugin(config?: AdapterConfig): Plugin {
  return async () => ({
    event: async ({ event }) => {
      await handleEvent(event as OpencodeEvent, config);
    },
  });
}

export const PlanCanvasPlugin: Plugin = createPlugin();

export default PlanCanvasPlugin;

export type { ParseWarning };
