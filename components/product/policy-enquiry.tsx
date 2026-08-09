/**
 * "Ask about this policy" — the WhatsApp handoff from a policy page.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2, §6.3).
 *
 * The policy pages state what the site can truthfully say and stop short of the terms,
 * which the owner has not supplied (DEBT-018). That makes a way to ask the actual question
 * the most useful thing on the page, not an afterthought.
 *
 * MASTER-SPEC §1: every dead end in this application ends in a WhatsApp conversation
 * rather than a form.
 */
'use client';

import { MessageCircle } from 'lucide-react';

import { buildWhatsAppUrl } from '@/lib/catalog/whatsapp';
import { clientEnv } from '@/lib/env';

export function PolicyEnquiry({ policy }: { policy: string }) {
  // Encoded by `buildWhatsAppUrl`; the policy name is ours, but it goes through the same
  // one function every other message does rather than being special-cased.
  const href = buildWhatsAppUrl(
    clientEnv.NEXT_PUBLIC_OWNER_WA,
    `Hi! I have a question about your ${policy.toLowerCase()}.`,
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-control items-center justify-center gap-2 self-start rounded-pill bg-taupe-deep px-6 text-body font-semibold text-white transition-transform duration-fast ease-standard active:scale-[0.98]"
    >
      <MessageCircle className="size-icon" aria-hidden="true" />
      Ask about this on WhatsApp
    </a>
  );
}
