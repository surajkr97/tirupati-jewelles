"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { login } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      // The cookie exists by now, but the Server Components in the router cache
      // were rendered without it. refresh() re-runs them so they see it.
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Is the API running?",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-700">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-[#EDE4D3] px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-700">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-[#EDE4D3] px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-[#B98A4A] hover:bg-[#a67a3f] disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-white text-sm font-medium tracking-wide px-5 py-2.5 rounded-lg shadow-sm cursor-pointer mt-1"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
