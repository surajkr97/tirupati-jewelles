import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/api-server";
import LogoutButton from "./logout-button";

export default async function AccountPage() {
  // This is the real gate. proxy.ts only checked that *a* cookie existed; here
  // FastAPI actually verifies the signature and expiry, so a forged or expired
  // token lands back on /login.
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  return (
    <main className="max-w-md mx-auto bg-[#FBF8F3] min-h-screen px-5 py-10">
      <div className="bg-white rounded-2xl border border-[#EDE4D3] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.03)] p-6">
        <h1 className="font-display text-xl text-gray-900 mb-1">My Account</h1>
        <p className="text-xs text-gray-500 mb-6">
          Rendered on the server — no loading flash, no token in JavaScript.
        </p>

        <dl className="text-sm divide-y divide-[#F1E9D8] border-y border-[#F1E9D8]">
          <div className="flex justify-between py-2.5">
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-900 font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-gray-500">User ID</dt>
            <dd className="text-gray-900 font-medium">{user.id}</dd>
          </div>
        </dl>

        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
