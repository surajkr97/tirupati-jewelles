/**
 * /signup — email → OTP → password.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
import Link from 'next/link';
import { Suspense } from 'react';

import { SignupForm } from '@/app/(auth)/signup/signup-form';
import { AuthShell } from '@/components/auth/auth-shell';
import { Skeleton } from '@/components/ui';
import { redirectIfSignedIn } from '@/lib/auth/signed-in-redirect';

export const metadata = { title: 'Create an account — Tirupati Jewelles' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Audit C-4. Creating a second account while signed into the first is never the intent.
  await redirectIfSignedIn((await searchParams).next);

  return (
    <AuthShell
      title="Create an account"
      subtitle="So your purchases, rates and estimates stay in one place."
      footer={
        <>
          Already have one?{' '}
          <Link href="/login" className="font-semibold text-rose-deep hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {/* `useSearchParams` (for `?next=`) opts this subtree into client rendering, so
            without a boundary Next cannot prerender the static shell around it and the build
            fails. The fallback matches the form's height so nothing shifts when it swaps in
            — the same pattern /login has used since Phase 3. */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-field-block w-full" />
            <Skeleton className="h-field-block w-full" />
            <Skeleton className="h-control w-full rounded-pill" />
          </div>
        }
      >
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
