/**
 * /forgot-password — request a code, then set a new password.
 * Created by Phase 3 (specs/03-auth.md §3.7).
 */
import Link from 'next/link';

import { ForgotPasswordForm } from '@/app/(auth)/forgot-password/forgot-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata = { title: 'Reset your password — Tirupati Jewelles' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll send a code to your mobile number or email."
      footer={
        <Link href="/login" className="font-semibold text-taupe-deep hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
