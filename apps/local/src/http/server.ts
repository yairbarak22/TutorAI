import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { BASE_HEADERS, Security } from "./security.ts";
import { StaticFiles } from "./static.ts";
import { ZodError } from "zod";
import { log } from "../log.ts";

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

export interface Route {
  method: string | string[];
  /** Exact path, or a prefix ending with "*". */
  path: string;
  kind: "api" | "control" | "public";
  handler: Handler;
}

export interface ServerOptions {
  security: Security;
  routes: Route[];
  statics: StaticFiles;
  /** Called on every authorized /api request (idle watchdog). */
  onActivity?: () => void;
}

/* ---------------- response helpers ---------------- */

export function send(res: ServerResponse, status: number, body: string | Uint8Array = "", headers: Record<string, string> = {}) {
  res.writeHead(status, { ...BASE_HEADERS, "Cache-Control": "no-store", ...headers });
  res.end(body);
}

export function json(res: ServerResponse, status: number, data: unknown) {
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json" });
}

/** Starts a newline-delimited JSON stream; returns a writer. */
export function ndjson(res: ServerResponse) {
  res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  return (event: unknown) => {
    if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** A stable code the page translates (the server never sends sentences for the student). */
    public kind?: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 512 * 1024 * 1024; // course files can be large PDFs or recordings

export async function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, "Too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, max = 64 * 1024 * 1024): Promise<unknown> {
  const body = await readBody(req, max);
  try {
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function match(route: Route, method: string, path: string) {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  if (!methods.includes(method)) return false;
  return route.path.endsWith("*") ? path.startsWith(route.path.slice(0, -1)) : path === route.path;
}

/* ---------------- the server ---------------- */

export function createHttpServer(opts: ServerOptions): Server {
  const { security, routes, statics } = opts;
  return createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      const hostCheck = security.checkHost(host);
      if (hostCheck === "bad") return send(res, 421, "Misdirected request");
      if (hostCheck === "redirect") return send(res, 308, "", { Location: `${security.origin}${req.url ?? "/"}` });

      const url = new URL(req.url ?? "/", security.origin);
      const method = req.method ?? "GET";
      const route = routes.find((r) => match(r, method, url.pathname));

      if (route) {
        if (route.kind === "api") {
          const v = security.guardApi(req);
          if (v) return json(res, v.status, { error: v.message });
          opts.onActivity?.();
        } else if (route.kind === "control") {
          const v = security.guardControl(req);
          if (v) return json(res, v.status, { error: v.message });
        }
        return await route.handler(req, res, url);
      }

      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/control/")) return json(res, 404, { error: "Not found" });
      if (method !== "GET" && method !== "HEAD") return send(res, 405, "Method not allowed");

      const file = await statics.get(url.pathname);
      if (!file) return send(res, 404, "Not found");
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": file.type, "Cache-Control": file.cache, "Content-Length": String(file.body.length) });
      res.end(method === "HEAD" ? undefined : file.body);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
      if (status === 500) log("error", `request failed: ${req.method} ${req.url?.split("?")[0]}: ${e instanceof Error ? e.message : String(e)}`);
      const kind = e instanceof HttpError ? e.kind : undefined;
      if (!res.headersSent) json(res, status, { error: status === 500 ? "Internal error" : e instanceof ZodError ? "Invalid request" : (e as Error).message, ...(kind ? { kind } : {}) });
      else res.end();
    }
  });
}

/** Listens on 127.0.0.1, trying the port and the next ones unless strict. */
export async function listen(server: Server, port: number, opts: { strict?: boolean; range?: number } = {}): Promise<number> {
  const tryPort = (p: number) =>
    new Promise<boolean>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (e.code === "EADDRINUSE") resolve(false);
        else reject(e);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, "127.0.0.1");
    });
  if (opts.strict) {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      if (await tryPort(port)) return port;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Port ${port} is busy`);
  }
  const range = opts.range ?? 10;
  for (let p = port; p < port + range; p++) if (await tryPort(p)) return p;
  throw new Error(`Ports ${port}-${port + range - 1} are busy`);
}
