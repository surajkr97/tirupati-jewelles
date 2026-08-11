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

import { buttonClasses } from '@/components/ui';
import { buildWhatsAppUrl } from '@/lib/catalog/whatsapp';

export function PolicyEnquiry({
  policy,
  ownerWhatsApp,
}: {
  policy: string;
  ownerWhatsApp: string;
}) {
  // Encoded by `buildWhatsAppUrl`; the policy name is ours, but it goes through the same
  // one function every other message does rather than being special-cased.
  const href = buildWhatsAppUrl(
    ownerWhatsApp,
    `Hi! I have a question about your ${policy.toLowerCase()}.`,
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses({ variant: 'accent', className: 'self-start' })}
    >
      <MessageCircle className="size-icon" aria-hidden="true" />
      Ask about this on WhatsApp
    </a>
  );
}
