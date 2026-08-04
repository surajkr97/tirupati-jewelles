"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { logout } from "@/lib/auth";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      // refresh() clears the router cache so the signed-in version of any
      // Server Component isn't left sitting in memory after logout.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={busy}
      className="w-full border border-[#EDE4D3] hover:bg-[#FBF8F3] disabled:opacity-60 transition-colors text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg cursor-pointer"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
