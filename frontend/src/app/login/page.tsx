import LoginForm from "./login-form";

// Server Component. Reading `searchParams` here rather than calling
// useSearchParams() in the form keeps the client bundle free of a Suspense
// bailout — the latter builds fine in dev but fails `next build` on a static
// page. searchParams is a Promise in Next 15+, hence the await.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="max-w-md mx-auto bg-[#FBF8F3] min-h-screen px-5 py-10">
      <div className="text-center mb-8">
        <h1 className="font-display text-2xl tracking-wide text-gray-900">
          TIRUPATI
        </h1>
        <p className="text-[11px] tracking-[0.35em] text-amber-700 -mt-1">
          JEWELLES
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#EDE4D3] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_12px_rgba(0,0,0,0.03)] p-6">
        <h2 className="font-display text-xl text-gray-900 mb-1">Sign in</h2>
        <p className="text-xs text-gray-500 mb-6">
          Access your account and order history
        </p>

        <LoginForm nextPath={safeNext(next)} />
      </div>
    </main>
  );
}

/**
 * Only allow same-origin relative paths. Without this check, a link like
 * /login?next=https://evil.com turns the login page into an open redirect.
 */
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/account";
}
