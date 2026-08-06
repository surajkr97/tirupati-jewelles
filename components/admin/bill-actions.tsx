/**
 * Send, mark-as-sent, resend and void.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.4, §8.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8 DESIGN: "Send flow is unambiguous — the admin always knows what state a bill is in."
 *
 *  There are exactly three states and the screen names all of them:
 *
 *    Not sent   → one primary action, "Send on WhatsApp".
 *    Opened     → WhatsApp has been opened; the app cannot know what happened next, so it
 *                 ASKS. §8.4: "Do not set it optimistically — the admin may have cancelled,
 *                 and a false 'sent' record is worse than no record."
 *    Sent       → when, and a resend that returns to the Opened state.
 *
 *  The middle state is the one that matters. A deep link hands control to another app and
 *  gets nothing back, so an honest UI has to admit that rather than guess.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use client';

import { useState, useTransition } from 'react';

import { markBillSent, regenerateBillPdf, voidBill } from '@/app/admin/bills/actions';
import { Button, Card, Input, toast } from '@/components/ui';

export interface BillActionsProps {
  orderId: string;
  orderNo: string;
  /** The `wa.me` link, built server-side from the signed PDF URL. */
  whatsAppUrl: string | null;
  /** Why there is no link, when there is none — a missing PDF or an unimplemented sender. */
  sendBlockedReason: string | null;
  sentAtLabel: string | null;
  voided: boolean;
}

export function BillActions({
  orderId,
  orderNo,
  whatsAppUrl,
  sendBlockedReason,
  sentAtLabel,
  voided,
}: BillActionsProps) {
  const [pending, startTransition] = useTransition();
  const [opened, setOpened] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  function confirmSent() {
    startTransition(async () => {
      const result = await markBillSent(orderId);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      setOpened(false);
      toast(`${orderNo} marked as sent.`);
    });
  }

  function regenerate() {
    startTransition(async () => {
      const result = await regenerateBillPdf(orderId);
      toast(result.ok ? 'Invoice re-rendered.' : result.error);
    });
  }

  function submitVoid() {
    setReasonError(null);
    startTransition(async () => {
      const result = await voidBill({ id: orderId, reason });
      if (!result.ok) {
        setReasonError(result.error);
        return;
      }
      setVoiding(false);
      setReason('');
      toast(`${orderNo} voided.`);
    });
  }

  if (voided) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold text-ink">Actions</h2>
        <p className="text-body text-muted">
          This bill is void. It is kept for the record and excluded from every total, and
          it cannot be sent again.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Send</h2>

      {sentAtLabel && (
        <p className="text-body text-up">Sent on WhatsApp — {sentAtLabel}.</p>
      )}

      {whatsAppUrl ? (
        <>
          {/*
            A real anchor, not a scripted `window.open`. On a phone this hands off to the
            WhatsApp app; a popup blocker never sees it, and long-press "copy link" works,
            which is how an admin recovers when the handoff fails.
          */}
          <a
            href={whatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpened(true)}
            className="inline-flex h-control-lg w-full items-center justify-center rounded-pill bg-taupe-deep px-6 text-body font-semibold text-white transition-transform duration-fast ease-standard active:scale-[0.98]"
          >
            {sentAtLabel ? 'Send again on WhatsApp' : 'Send on WhatsApp'}
          </a>

          {opened && (
            <div className="flex flex-col gap-2 rounded-field bg-taupe-lt/40 p-4">
              <p className="text-body text-ink">
                Did the message send? We can&rsquo;t tell from here.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="md"
                  loading={pending}
                  onClick={confirmSent}
                >
                  Yes, mark as sent
                </Button>
                <Button variant="ghost" size="md" onClick={() => setOpened(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-body text-muted">{sendBlockedReason}</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="md" loading={pending} onClick={regenerate}>
          Re-render invoice
        </Button>

        {!voiding ? (
          <Button
            variant="ghost"
            size="md"
            className="ml-auto text-muted hover:text-down"
            onClick={() => setVoiding(true)}
          >
            Void this bill
          </Button>
        ) : null}
      </div>

      {voiding && (
        <div className="flex flex-col gap-2 rounded-field bg-down/5 p-4">
          {/* Destructive and irreversible, so it explains itself before it acts (§7 DESIGN). */}
          <p className="text-body text-ink">
            Voiding keeps the invoice and its number — the law requires that — and removes
            it from your sales totals. It cannot be undone.
          </p>
          <Input
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError ?? undefined}
            placeholder="Returned, cancelled, entered twice…"
            maxLength={200}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              loading={pending}
              disabled={reason.trim().length < 3}
              onClick={submitVoid}
            >
              Void {orderNo}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setVoiding(false);
                setReasonError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
