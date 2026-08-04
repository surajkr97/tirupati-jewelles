import { cookies } from "next/headers";

import { API_BASE, ApiError } from "./api";
import type { User } from "./auth";

/**
 * Base URL for requests made *from the server*.
 *
 * Under docker compose the browser and the Next server reach the API by
 * different names: the browser uses the published port on localhost, while this
 * process has to use the compose service name, since inside the web container
 * localhost is the web container. Outside docker both are the same host, so the
 * public URL is the right fallback.
 */
const SERVER_API_BASE = process.env.INTERNAL_API_URL || API_BASE;

/**
 * Server-side fetch against FastAPI, for use in Server Components.
 *
 * On the server there is no browser cookie jar, so `credentials: "include"`
 * does nothing here — the incoming request's cookies have to be forwarded by
 * hand. `cookies()` is async in Next 15+, hence the await.
 */
export async function serverFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const cookieStore = await cookies();

  const res = await fetch(`${SERVER_API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, cookie: cookieStore.toString() },
    // Per-user responses must never land in the shared data cache, or one
    // user's account page can be served to another.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Returns the signed-in user, or null when the cookie is missing or expired. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await serverFetch<User>("/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
