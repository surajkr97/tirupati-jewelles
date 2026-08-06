/**
 * Media slot mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6, §7.7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Every URL that reaches the database has been through `checkImageUrl` first.
 *
 *  §7.7: "Do not proxy-fetch at render time. Validate once on save, store the URL, let
 *  `next/image` handle it thereafter." So the expensive, dangerous operation happens here,
 *  exactly once per save, and never again on a page render.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { adminAction, type ActionResult } from '@/lib/admin/actions';
import { BILL_LOGO_SLOT, invalidateBillLogo } from '@/lib/bills/logo';
import { db } from '@/lib/db';
import { checkImageUrl, FAILURE_MESSAGE } from '@/lib/media/fetch-image';
import { isKnownSlot } from '@/lib/media/slots';

/** MASTER-SPEC §6 lists `media` among the revalidation tags. */
const MEDIA_TAG = 'media';

/** Surfaces that render a media slot, invalidated on every save. */
const MEDIA_SURFACES = ['/', '/collections'] as const;

const schema = z.object({
  slotKey: z.string().min(1).max(64),
  // Empty string clears the slot (§7.6: "Clearing a slot restores the branded empty frame").
  imageUrl: z.string().max(2048),
  linkUrl: z.string().max(2048),
  headline: z.string().max(120),
  subtext: z.string().max(240),
  isActive: z.boolean(),
});

export type SaveSlotResult = ActionResult<{ imageUrl: string | null }>;

export async function saveMediaSlot(input: unknown): Promise<SaveSlotResult> {
  return adminAction(async ({ audit }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Check the highlighted fields.' };

    const { slotKey, imageUrl, linkUrl, headline, subtext, isActive } = parsed.data;

    // The slot list is fixed by §7.6. An unknown key is not a validation nicety — it would
    // let an admin create rows the storefront never reads.
    if (!isKnownSlot(slotKey)) {
      return { ok: false, error: 'Unknown media slot.' };
    }

    const existing = await db.mediaSlot.findUnique({ where: { slotKey } });

    /**
     * §7.7 in full, for any URL that is not being cleared.
     *
     * The FINAL url is stored, not the one that was typed: `checkImageUrl` follows
     * redirects itself and returns where it actually landed, so what is saved is the thing
     * that was verified rather than something that merely pointed at it.
     */
    let storedUrl: string | null = null;

    if (imageUrl.trim() !== '') {
      const check = await checkImageUrl(imageUrl.trim());
      if (!check.ok) {
        return {
          ok: false,
          error: `${FAILURE_MESSAGE[check.reason]} ${check.detail}`.trim(),
          field: 'imageUrl',
        };
      }
      storedUrl = check.url;
    }

    /**
     * A link URL is never fetched, so it needs no SSRF check — but it IS rendered as an
     * `href`, so the scheme matters: `javascript:` in an href is XSS.
     */
    let storedLink: string | null = null;
    if (linkUrl.trim() !== '') {
      const link = linkUrl.trim();
      const relative = link.startsWith('/') && !link.startsWith('//');
      const https = /^https:\/\//i.test(link);

      if (!relative && !https) {
        return {
          ok: false,
          error: 'A link must start with / or https://',
          field: 'linkUrl',
        };
      }
      storedLink = link;
    }

    const saved = await db.mediaSlot.upsert({
      where: { slotKey },
      update: {
        imageUrl: storedUrl,
        linkUrl: storedLink,
        headline: headline.trim() || null,
        subtext: subtext.trim() || null,
        isActive,
      },
      create: {
        slotKey,
        imageUrl: storedUrl,
        linkUrl: storedLink,
        headline: headline.trim() || null,
        subtext: subtext.trim() || null,
        isActive,
      },
    });

    await audit({
      action: 'MEDIA_SET',
      entity: 'MediaSlot',
      entityId: slotKey,
      before: existing
        ? {
            imageUrl: existing.imageUrl,
            headline: existing.headline,
            isActive: existing.isActive,
          }
        : null,
      after: {
        imageUrl: saved.imageUrl,
        headline: saved.headline,
        isActive: saved.isActive,
      },
    });

    // §7 TEST: "Media slot change → revalidateTag('media') → homepage updates." The tag is
    // what MASTER-SPEC §6 names; the paths are what actually invalidate an ISR page today
    // (D-012), so both are called.
    revalidateTag(MEDIA_TAG, 'max');
    for (const path of MEDIA_SURFACES) revalidatePath(path);

    /**
     * The invoice logo is not an ISR surface — it is bytes cached in Redis for six hours
     * (Phase 8 §8.3), so `revalidatePath` cannot reach it. Without this, an owner who
     * uploads a new logo keeps printing the old one for the rest of the afternoon and has
     * no way to tell why.
     */
    if (saved.slotKey === BILL_LOGO_SLOT) await invalidateBillLogo();

    return { ok: true, data: { imageUrl: saved.imageUrl } };
  });
}

/**
 * Validate a URL without saving it.
 *
 * §7.6 asks for a "live preview at phone width before saving", and previewing an unverified
 * URL would mean rendering an attacker-chosen image — so the preview shows only what has
 * passed the same check the save performs.
 */
export async function validateImageUrl(
  url: unknown,
): Promise<ActionResult<{ url: string; format: string; bytes: number }>> {
  return adminAction(async () => {
    if (typeof url !== 'string' || url.trim() === '') {
      return { ok: false, error: 'Paste an image URL first.' };
    }

    const check = await checkImageUrl(url.trim());
    if (!check.ok) {
      return {
        ok: false,
        error: `${FAILURE_MESSAGE[check.reason]} ${check.detail}`.trim(),
      };
    }

    return {
      ok: true,
      data: { url: check.url, format: check.format, bytes: check.bytes },
    };
  });
}
