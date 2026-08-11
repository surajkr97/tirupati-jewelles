/**
 * One media slot.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6).
 *
 * §7.6: "Each slot accepts **either** a pasted URL **or** a direct upload ... Live preview
 * at phone width before saving ... Clearing a slot restores the branded empty frame — never
 * a broken image."
 *
 * The preview only ever shows a URL the server has already validated. Rendering whatever
 * has been typed would mean the admin's browser fetching an arbitrary URL on every
 * keystroke, which is a smaller version of the same problem §7.7 is about.
 */
'use client';

import { Check, Loader2, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { saveMediaSlot, validateImageUrl } from '@/app/admin/media/actions';
import { Button, Card, ImageFrame, Input, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface MediaSlotCardProps {
  slotKey: string;
  label: string;
  where: string;
  recommended: string;
  ratio: string;
  supportsText: boolean;
  initial: {
    imageUrl: string | null;
    linkUrl: string | null;
    headline: string | null;
    subtext: string | null;
    isActive: boolean;
  };
}

export function MediaSlotCard({
  slotKey,
  label,
  where,
  recommended,
  ratio,
  supportsText,
  initial,
}: MediaSlotCardProps) {
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '');
  const [linkUrl, setLinkUrl] = useState(initial.linkUrl ?? '');
  const [headline, setHeadline] = useState(initial.headline ?? '');
  const [subtext, setSubtext] = useState(initial.subtext ?? '');

  /** Only ever a server-validated URL — see the file header. */
  const [preview, setPreview] = useState<string | null>(initial.imageUrl);
  const [error, setError] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const [saving, startSaving] = useTransition();

  const check = () => {
    setError(null);
    startChecking(async () => {
      const result = await validateImageUrl(imageUrl);
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      // The final URL after redirects — the one that was actually verified.
      setImageUrl(result.data.url);
      setPreview(result.data.url);
      toast(
        `Looks good — ${result.data.format.toUpperCase()}, ${Math.round(result.data.bytes / 1024)} KB`,
      );
    });
  };

  const save = () => {
    setError(null);
    startSaving(async () => {
      const result = await saveMediaSlot({
        slotKey,
        imageUrl,
        linkUrl,
        headline,
        subtext,
        isActive: true,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.data.imageUrl);
      // §7 DESIGN: "Save state always clear."
      toast(result.data.imageUrl ? `${label} updated` : `${label} cleared`);
    });
  };

  const clear = () => {
    setImageUrl('');
    setPreview(null);
    setError(null);
    startSaving(async () => {
      const result = await saveMediaSlot({
        slotKey,
        imageUrl: '',
        linkUrl,
        headline,
        subtext,
        isActive: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast(`${label} cleared`);
    });
  };

  return (
    <Card className="flex flex-col gap-4" data-testid={`slot-${slotKey}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-h3 font-semibold text-ink">{label}</h2>
          <p className="text-small text-muted">{where}</p>
        </div>
        <p className="shrink-0 rounded-pill bg-rose-tint px-2 py-1 text-small text-ink tabular">
          {recommended}
        </p>
      </div>

      {/*
        §7.6: "Live preview at phone width before saving." The frame is capped at 375px so
        what the owner sees is what a customer sees — and an empty slot renders Phase 2's
        branded monogram, never a broken image.
      */}
      <div className="max-w-[375px]">
        <ImageFrame
          src={preview}
          alt={headline || label}
          ratio={ratio}
          sizes="375px"
          rounded="field"
        />
      </div>

      <Input
        label="Image URL"
        inputMode="url"
        placeholder="https://res.cloudinary.com/…"
        value={imageUrl}
        error={error ?? undefined}
        hint="Paste an https link from an allowed image host."
        onChange={(event) => {
          setImageUrl(event.target.value);
          setError(null);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={check}
          disabled={checking || imageUrl.trim() === ''}
          data-testid={`check-${slotKey}`}
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          Check &amp; preview
        </Button>

        {initial.imageUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={saving}
            // §7 DESIGN: "Destructive actions are visually distinct."
            className="text-down hover:bg-down/10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>

      {supportsText && (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <Input
            label="Headline"
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
          />
          <Input
            label="Subtext"
            value={subtext}
            onChange={(event) => setSubtext(event.target.value)}
          />
          <Input
            label="Link"
            inputMode="url"
            placeholder="/collections/rings"
            hint="A path starting with / or a full https link."
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
        </div>
      )}

      <Button
        variant="primary"
        size="md"
        full
        loading={saving}
        onClick={save}
        data-testid={`save-${slotKey}`}
        className={cn(saving && 'pointer-events-none')}
      >
        Save
      </Button>
    </Card>
  );
}
