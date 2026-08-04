import { apiFetch } from "./api";

export interface User {
  id: number;
  email: string;
}

/**
 * `/auth/login` is backed by FastAPI's OAuth2PasswordRequestForm, so it expects
 * form-encoded data — not JSON — and the email goes in a field called
 * `username`. Sending JSON here is the classic 422.
 *
 * We never touch the returned token: the browser stores it as an httpOnly
 * cookie that JavaScript cannot read, which is what makes it XSS-resistant.
 */
export async function login(email: string, password: string): Promise<void> {
  const body = new URLSearchParams({ username: email, password });

  await apiFetch<unknown>("/auth/login", {
    method: "POST",
    // Deliberately no Content-Type header — the browser derives
    // application/x-www-form-urlencoded from the URLSearchParams body.
    body,
  });
}

export async function register(
  email: string,
  password: string,
  confirmPassword: string,
): Promise<User> {
  return apiFetch<User>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      confirm_password: confirmPassword,
    }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me");
}
