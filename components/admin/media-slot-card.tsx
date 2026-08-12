/**
 * One media slot.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6), redesigned by Stage 5D (§15–§20).
 *
 * §7.6: "Each slot accepts **either** a pasted URL **or** a direct upload ... Live preview
 * at phone width before saving ... Clearing a slot restores the branded empty frame — never
 * a broken image."
 *
 * The preview only ever shows a URL the server has already validated. Rendering whatever
 * has been typed would mean the admin's browser fetching an arbitrary URL on every
 * keystroke, which is a smaller version of the same problem §7.7 is about.
 *
 * ── Stage 5D ──
 *
 *  - **Clearing asks first, and names the slot (§20).** "Clear" removed the image on the
 *    first tap, with no confirmation and no undo. `saveMediaSlot` is called with the same
 *    empty `imageUrl` it always was; only the number of taps changed.
 *  - **The Clear control tracks the slot's actual state, not its state at page load.**
 *    It keyed off `initial.imageUrl`, so an image saved a moment ago could not be cleared
 *    until the page was reloaded, and an image already cleared still offered the button.
 *  - **Save gains weight only when there is something to save (§12)**, the rule the rate
 *    editor follows. Twelve full-strength "Save" bars, all inert, was the loudest thing on
 *    the screen and none of it was actionable.
 */
'use client';

import { Check, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { saveMediaSlot, validateImageUrl } from '@/app/admin/media/actions';
import { Button, Card, ImageFrame, Input, toast } from '@/components/ui';

export interface MediaSlotCardProps {
  slotKey: string;
  label: string;
  where: string;
  recommended: string;
  ratio: string;
  supportsText: boolean;
  /** Does anything on the site render this slot? See `SlotDefinition.live`. */
  live: boolean;
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
  live,
  initial,
}: MediaSlotCardProps) {
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '');
  const [linkUrl, setLinkUrl] = useState(initial.linkUrl ?? '');
  const [headline, setHeadline] = useState(initial.headline ?? '');
  const [subtext, setSubtext] = useState(initial.subtext ?? '');

  /** What the database holds, so the save button can tell whether anything has moved. */
  const [saved, setSaved] = useState({
    imageUrl: initial.imageUrl ?? '',
    linkUrl: initial.linkUrl ?? '',
    headline: initial.headline ?? '',
    subtext: initial.subtext ?? '',
  });

  /** Only ever a server-validated URL — see the file header. */
  const [preview, setPreview] = useState<string | null>(initial.imageUrl);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
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
      setSaved({ imageUrl: result.data.imageUrl ?? '', linkUrl, headline, subtext });
      // §7 DESIGN: "Save state always clear."
      toast(result.data.imageUrl ? `${label} updated` : `${label} cleared`);
    });
  };

  const clear = () => {
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
      setImageUrl('');
      setPreview(null);
      setSaved({ imageUrl: '', linkUrl, headline, subtext });
      setConfirmClear(false);
      toast(`${label} cleared`);
    });
  };

  const dirty =
    imageUrl !== saved.imageUrl ||
    linkUrl !== saved.linkUrl ||
    headline !== saved.headline ||
    subtext !== saved.subtext;

  return (
    <Card className="flex flex-col gap-4" data-testid={`slot-${slotKey}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-h3 font-semibold text-ink">{label}</h3>
          <p className="text-small text-muted">{where}</p>
        </div>
        {/* The recommendation is a measurement, so it gets `.num` and stays on one line. */}
        <p className="shrink-0 rounded-pill bg-rose-tint px-2 py-1 text-small text-ink num">
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
          alt={preview ? `Current ${label.toLowerCase()}` : ''}
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
          setConfirmClear(false);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={check}
          loading={checking}
          loadingLabel="Checking…"
          disabled={imageUrl.trim() === ''}
          data-testid={`check-${slotKey}`}
        >
          <Check className="size-4" aria-hidden="true" />
          Check &amp; preview
        </Button>

        {/* Keyed off what is stored NOW, not off what was stored when the page rendered. */}
        {saved.imageUrl !== '' && !confirmClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={saving}
            // §7 DESIGN: "Destructive actions are visually distinct."
            className="text-down hover:bg-down/10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>

      {/* §20 — the confirmation says which image, not "are you sure?". */}
      {confirmClear && (
        <div className="flex flex-col gap-4 rounded-field bg-down/10 p-4">
          <p className="text-small text-ink">
            Clear the <strong>{label}</strong> image? The slot goes back to the branded
            placeholder{live ? ' on the live site' : ''}. You will need the link again to
            put it back.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClear(false)}
              disabled={saving}
            >
              Keep it
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-down hover:bg-down/90"
              loading={saving}
              loadingLabel="Clearing…"
              onClick={clear}
              data-testid={`confirm-clear-${slotKey}`}
            >
              Clear the image
            </Button>
          </div>
        </div>
      )}

      {supportsText && (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <Input
            label="Headline"
            hint="Shown over the image. Also its description for screen readers."
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

      {/*
        §12, and the rate editor's rule: full strength only when it has something to do.
        Twelve of these on one page, every one of them filled and inert, was the heaviest
        thing on the screen before anybody had typed.
      */}
      <Button
        variant={dirty ? 'primary' : 'outline'}
        size="md"
        full
        disabled={!dirty}
        loading={saving}
        loadingLabel="Saving…"
        onClick={save}
        data-testid={`save-${slotKey}`}
      >
        {dirty ? 'Save' : 'No changes'}
      </Button>
    </Card>
  );
}
