export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Must match COOKIE_NAME in the backend's .env — see server/app/core/config.py. */
export const AUTH_COOKIE = "access_token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Browser-side fetch against the FastAPI backend.
 *
 * `credentials: "include"` is the entire point of this wrapper — without it the
 * browser will not attach the auth cookie to a cross-origin request, and every
 * protected call comes back 401. It also requires `allow_credentials=True` on
 * the server's CORS middleware.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** FastAPI puts errors in `detail`, which is either a string or a list for 422s. */
async function readError(res: Response): Promise<string> {
  try {
    const { detail } = await res.json();
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail[0]?.msg ?? "Request failed";
  } catch {
    // fall through to the generic message
  }
  return `Request failed (${res.status})`;
}
