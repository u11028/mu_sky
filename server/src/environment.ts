// Settings that differ between a home computer and a hosted server.

import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where progress, accounts and the GM key are kept: server/data, or a mounted disk on a host. */
export const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url));

export function dataFile(name: string) {
  return join(DATA_DIR, name);
}

/**
 * The player's own address. Behind a host's proxy (TRUST_PROXY=1) every connection comes from the
 * proxy, so the address it forwards is used instead; otherwise a ban by address would ban everyone.
 */
export function clientAddress(request?: IncomingMessage) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request?.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request?.socket?.remoteAddress ?? "";
}
