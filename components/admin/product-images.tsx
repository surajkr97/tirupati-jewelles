/**
 * Product image management.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4), redesigned by Stage 5D (§15–§20).
 *
 * §7.4: "Image management: multiple images, drag to reorder, alt text per image."
 *
 * Reordering is up/down buttons rather than drag. Drag-and-drop on a phone competes with
 * scrolling — the gesture is the same one — and this screen is explicitly for someone
 * "standing in a shop, between customers". Buttons work one-handed, work with a screen
 * reader, and need no library. The stored `sortOrder` is identical either way, so a drag
 * affordance can be added later on top of the same action.
 *
 * ── Stage 5D changed three things, all of them presentation ──
 *
 *  1. **Removing an image asks first (§20).** Three 44px targets sat side by side and the
 *     third deleted a photograph with no confirmation and no undo — the Phase 7 code
 *     comment even said "a miss deletes an image", then did nothing about it. The
 *     confirmation names which image, because "Are you sure?" is the version people learn
 *     to dismiss. `removeProductImage` is called with exactly the same argument as before.
 *
 *  2. **An upload failure no longer reports itself on the paste-a-link field (§11, §17).**
 *     One `error` state fed the URL input, so "that upload did not finish" appeared as a
 *     validation error under a field the admin had not touched. Three separate states now,
 *     each rendered beside the control that produced it.
 *
 *  3. **The thumbnails are big enough to recognise a piece by (§14).** 64px of a gold chain
 *     on a cream ground is a smudge.
 *
 * Nothing about the upload mechanism moved: the signed grant, the direct-to-Cloudinary POST,
 * the signed field list and the server-side re-verification are byte for byte what §7.8
 * specified.
 */
'use client';

import { ArrowDown, ArrowUp, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  addProductImage,
  confirmUpload,
  createUploadTicket,
  removeProductImage,
  reorderProductImages,
} from '@/app/admin/products/actions';
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  ImageFrame,
  Input,
  toast,
} from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface ProductImageRow {
  id: string;
  url: string;
  alt: string;
}

export function ProductImages({
  productId,
  images: initial,
}: {
  productId: string;
  images: ProductImageRow[];
}) {
  const [images, setImages] = useState(initial);
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');

  /**
   * Three failures, three places to say so (§11).
   *
   * `linkError` belongs to the URL field, `uploadError` to the upload control, `listError`
   * to the gallery above them both — a reorder that would not save is not a comment on
   * anything the admin has typed.
   */
  const [linkError, setLinkError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  /** The image the admin has asked to remove, awaiting confirmation (§20). */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  /**
   * §7.8: "Direct-to-provider signed uploads. The image bytes never pass through the app
   * server."
   *
   * The server issues a signature; the file goes browser → Cloudinary; the server is told
   * where it landed and verifies it independently. This function never sends the file
   * anywhere near our own origin.
   */
  const upload = async (file: File) => {
    setUploadError(null);

    const ticket = await createUploadTicket();
    if (!ticket.ok) {
      setUploadError(ticket.error);
      return;
    }

    const grant = ticket.data;

    // Checked here purely so the user finds out before a 10MB transfer, not because this
    // is the control — the real cap is inside the signature and enforced by Cloudinary.
    // The limit is read from the grant rather than repeated as a literal, so the message
    // cannot drift from the figure the server actually signed.
    if (file.size > grant.maxBytes) {
      setUploadError(
        `That image is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${Math.round(
          grant.maxBytes / 1024 / 1024,
        )} MB — try exporting it smaller.`,
      );
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('api_key', grant.apiKey);
      body.append('timestamp', String(grant.timestamp));
      body.append('signature', grant.signature);
      // Every field below is covered by the signature; changing one here would make
      // Cloudinary reject the upload.
      body.append('folder', grant.folder);
      body.append('public_id', grant.publicId);
      body.append('eager', 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400');
      body.append('eager_async', 'true');
      body.append('image_metadata', 'false');
      body.append('invalidate', 'true');
      body.append('allowed_formats', grant.allowedFormats.join(','));
      // `resource_type` is not sent: it is the endpoint, not a signed parameter.

      const response = await fetch(grant.url, { method: 'POST', body });
      if (!response.ok) {
        /**
         * §17 — the provider's own words are not shown.
         *
         * Cloudinary returns things like "Invalid Signature abc123… String to sign -
         * 'folder=…'", which names our folder layout and teaches the reader nothing. The
         * refusal is reported; the internals are not.
         */
        setUploadError(
          'That upload was refused. Check the file is a JPG, PNG, WebP or AVIF image and try again.',
        );
        return;
      }

      const uploaded = (await response.json()) as { secure_url: string };

      // The server re-verifies: our cloud, our folder, our public id, and then the same
      // magic-byte check a pasted URL gets.
      const confirmed = await confirmUpload({
        productId,
        url: uploaded.secure_url,
        publicId: grant.publicId,
        alt,
      });

      if (!confirmed.ok) {
        setUploadError(confirmed.error);
        return;
      }

      setImages((prev) => [
        ...prev,
        { id: confirmed.data.id, url: confirmed.data.url, alt },
      ]);
      setAlt('');
      toast('Image uploaded');
    } catch {
      setUploadError('That upload did not finish. Check the connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const add = () => {
    setLinkError(null);
    startTransition(async () => {
      const result = await addProductImage({ productId, url, alt });
      if (!result.ok) {
        setLinkError(result.error);
        return;
      }
      // The URL the server verified, after redirects — not what was typed.
      setImages((prev) => [...prev, { id: result.data.id, url: result.data.url, alt }]);
      setUrl('');
      setAlt('');
      toast('Image added');
    });
  };

  const remove = (id: string) => {
    setListError(null);
    startTransition(async () => {
      const result = await removeProductImage(id);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      setImages((prev) => prev.filter((image) => image.id !== id));
      setConfirmRemove(null);
      toast('Image removed');
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const next = [...images];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);

    // Optimistic: the list reorders immediately and rolls back if the save fails. Waiting
    // for a round trip per tap makes reordering six images feel broken.
    const previous = images;
    setImages(next);
    setListError(null);

    startTransition(async () => {
      const result = await reorderProductImages({
        productId,
        ids: next.map((image) => image.id),
      });
      if (!result.ok) {
        setImages(previous);
        setListError(result.error);
      }
    });
  };

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">Photos</h2>
        <p className="text-small text-muted">
          The first one is what a customer sees in the collection grid and in search.
        </p>
      </div>

      {listError && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
        >
          {listError}
        </p>
      )}

      {images.length === 0 ? (
        // §21 — the empty state says what to do, and the control is directly below it.
        <EmptyState
          icon={<ImagePlus className="size-6" aria-hidden="true" />}
          title="No photos yet"
          description="The site shows a branded placeholder until you add one. Paste a link or upload from this phone."
        />
      ) : (
        <ul className="flex flex-col">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="flex flex-col gap-2 border-b border-line py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                {/*
                  96px, not 64px (§14).

                  Off the spacing scale on purpose and stated here rather than reached for:
                  at 320px the row holds a 96px square and a truncating caption, and the
                  three 44px controls drop to their own line beneath. `max-w-[375px]` in the
                  media slot card is the same class of measured figure.
                */}
                <div className="w-[96px] shrink-0">
                  <ImageFrame
                    src={image.url}
                    // The caption beside it already reports the alt text, and an admin
                    // reordering photos needs to know WHICH row this is — so the accessible
                    // name is positional rather than a second reading of the same string.
                    alt={`Photo ${index + 1} of ${images.length}`}
                    ratio="1/1"
                    sizes="96px"
                    rounded="field"
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-1">
                  {/* §19 — which image is the one the shop leads with. */}
                  {index === 0 && (
                    <Badge tone="neutral" className="w-fit">
                      Cover
                    </Badge>
                  )}
                  <p className="truncate text-small text-muted">
                    {image.alt || <span className="italic">No alt text</span>}
                  </p>
                </div>
              </div>

              {confirmRemove === image.id ? (
                /**
                 * §20 — the confirmation names the image.
                 *
                 * Inline rather than a modal: a dialog for a six-photo gallery is heavier
                 * than the decision, and an inline strip keeps the thumbnail it refers to on
                 * screen, which is the whole point of naming it.
                 */
                <div
                  className="flex min-w-0 flex-col gap-2 rounded-field bg-down/10 p-2 sm:max-w-xs"
                  data-testid={`remove-confirm-${index}`}
                >
                  {/* The alt text is admin-supplied and can run to 200 characters, so the
                      quotation is clamped rather than allowed to reflow the row. */}
                  <p className="line-clamp-2 px-2 text-small text-ink">
                    Remove photo <span className="num">{index + 1}</span>
                    {image.alt ? ` — “${image.alt}”` : ''}?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemove(null)}
                      disabled={pending}
                    >
                      Keep
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="bg-down hover:bg-down/90"
                      loading={pending}
                      loadingLabel="Removing…"
                      onClick={() => remove(image.id)}
                      data-testid={`confirm-remove-${index}`}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex shrink-0 justify-end gap-1">
                  <IconButton
                    label={`Move photo ${index + 1} up`}
                    disabled={index === 0 || pending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-icon" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move photo ${index + 1} down`}
                    disabled={index === images.length - 1 || pending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-icon" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove photo ${index + 1}`}
                    destructive
                    disabled={pending}
                    onClick={() => setConfirmRemove(image.id)}
                  >
                    <Trash2 className="size-icon" aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4 border-t border-line pt-6">
        <h3 className="text-body font-semibold text-ink">Add a photo</h3>

        <Input
          label="Alt text"
          hint="What the picture shows, for screen readers and search. Used by whichever you add next."
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
        />

        {/* §7.6: "Each slot accepts either a pasted URL or a direct upload." Same for a
            product gallery — the shop photographs pieces on a phone, so the upload is the
            primary control and the link is the fallback. */}
        <label
          className={cn(
            buttonClasses({ variant: 'primary', size: 'md', full: true }),
            'cursor-pointer',
            uploading && 'pointer-events-none opacity-40 saturate-50',
          )}
        >
          <Upload className="size-4" aria-hidden="true" />
          {/* §16 — no invented progress bar. `fetch` reports no upload progress, so a
              determinate bar here would be a drawing rather than a measurement. */}
          {uploading ? 'Uploading…' : 'Upload a photo'}
          <input
            type="file"
            // The browser's picker filter. Not a control — the signed `allowed_formats`
            // and the magic-byte check are.
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            disabled={uploading}
            data-testid="upload-image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file twice fires a change event again — §17's
              // retry, for the case where the first attempt failed on the network.
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>

        {uploadError && (
          <p
            role="alert"
            className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
          >
            {uploadError}
          </p>
        )}

        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <Input
            label="Or paste an image link"
            inputMode="url"
            placeholder="https://res.cloudinary.com/…"
            hint="An https link from an allowed image host."
            value={url}
            error={linkError ?? undefined}
            onChange={(event) => {
              setUrl(event.target.value);
              setLinkError(null);
            }}
          />
          <Button
            variant="outline"
            size="md"
            onClick={add}
            loading={pending}
            loadingLabel="Checking…"
            disabled={url.trim() === '' || uploading}
            data-testid="add-image"
          >
            Add from link
          </Button>
        </div>
      </div>
    </Card>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // 44×44 minimum (MASTER-SPEC §3) — these sit adjacent and a miss reaches for an image.
      className={
        'flex size-tap items-center justify-center rounded-pill transition-colors duration-fast ease-standard ' +
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-30 ' +
        (destructive
          ? 'text-muted hover:bg-down/10 hover:text-down'
          : 'text-muted hover:bg-rose-tint hover:text-ink')
      }
    >
      {children}
    </button>
  );
}
