/**
 * /login — one field, phone or email.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
import Link from 'next/link';
import { Suspense } from 'react';

import { LoginForm } from '@/app/(auth)/login/login-form';
import { AuthShell } from '@/components/auth/auth-shell';
import { Skeleton } from '@/components/ui';

export const metadata = { title: 'Sign in — Tirupati Jewelles' };

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your mobile number or email address."
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
            <Skeleton className="h-[76px] w-full" />
            <Skeleton className="h-[76px] w-full" />
            <Skeleton className="h-control w-full rounded-pill" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
