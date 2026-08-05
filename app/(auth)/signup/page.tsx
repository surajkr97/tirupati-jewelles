/**
 * /signup — email → OTP → password.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
import Link from 'next/link';

import { SignupForm } from '@/app/(auth)/signup/signup-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata = { title: 'Create an account — Tirupati Jewelles' };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create an account"
      footer={
        <>
          Already have one?{' '}
          <Link href="/login" className="font-semibold text-taupe-deep hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
