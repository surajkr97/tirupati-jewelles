/**
 * /login — one field, phone or email.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
import Link from 'next/link';
import { Suspense } from 'react';

import { LoginForm } from '@/app/(auth)/login/login-form';
import { AuthShell } from '@/components/auth/auth-shell';
import { Skeleton } from '@/components/ui';
import { redirectIfSignedIn } from '@/lib/auth/signed-in-redirect';

export const metadata = { title: 'Sign in — Tirupati Jewelles' };

/**
 * `searchParams` is a promise in Next 16 (D-002), and reading it opts this page into dynamic
 * rendering — which the signed-in check below requires anyway.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Audit C-4: a signed-in visitor was shown the sign-in form.
  await redirectIfSignedIn((await searchParams).next);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in with your mobile number or email address."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="font-semibold text-rose-deep hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {/* LoginForm reads `?next=` via useSearchParams, which opts the subtree into
          client-side rendering. Without a Suspense boundary Next cannot prerender the
          static shell around it and the build fails. The fallback matches the form's
          height so there is no layout shift when it swaps in. */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-field-block w-full" />
            <Skeleton className="h-field-block w-full" />
            <Skeleton className="h-control w-full rounded-pill" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
