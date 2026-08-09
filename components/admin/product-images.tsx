/**
 * Product image management.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 *
 * §7.4: "Image management: multiple images, drag to reorder, alt text per image."
 *
 * Reordering is up/down buttons rather than drag. Drag-and-drop on a phone competes with
 * scrolling — the gesture is the same one — and this screen is explicitly for someone
 * "standing in a shop, between customers". Buttons work one-handed, work with a screen
 * reader, and need no library. The stored `sortOrder` is identical either way, so a drag
 * affordance can be added later on top of the same action.
 */
'use client';

import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  addProductImage,
  confirmUpload,
  createUploadTicket,
  removeProductImage,
  reorderProductImages,
} from '@/app/admin/products/actions';
import { Button, Card, ImageFrame, Input, toast } from '@/components/ui';

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  /**
   * §7.8: "Direct-to-provider signed uploads. The image bytes never pass through the app
   * server."
   *
   * The server issues a signature; the file goes browser → Cloudinary; the server is told
   * where it landed and verifies it independently. This function never sends the file
   * anywhere near our own origin.
   */
  const upload = async (file: File) => {
    setError(null);

    const ticket = await createUploadTicket();
    if (!ticket.ok) {
      setError(ticket.error);
      return;
    }

    const grant = ticket.data;

    // Checked here purely so the user finds out before a 10MB transfer, not because this
    // is the control — the real cap is inside the signature and enforced by Cloudinary.
    if (file.size > grant.maxBytes) {
      setError(
        `That image is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 10 MB.`,
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
        const detail = await response.json().catch(() => null);
        setError(detail?.error?.message ?? 'That upload was refused.');
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
        setError(confirmed.error);
        return;
      }

      setImages((prev) => [
        ...prev,
        { id: confirmed.data.id, url: confirmed.data.url, alt },
      ]);
      setAlt('');
      toast('Image uploaded');
    } catch {
      setError('That upload did not finish. Check the connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const add = () => {
    setError(null);
    startTransition(async () => {
      const result = await addProductImage({ productId, url, alt });
      if (!result.ok) {
        setError(result.error);
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
    startTransition(async () => {
      const result = await removeProductImage(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setImages((prev) => prev.filter((image) => image.id !== id));
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

    startTransition(async () => {
      const result = await reorderProductImages({
        productId,
        ids: next.map((image) => image.id),
      });
      if (!result.ok) {
        setImages(previous);
        setError(result.error);
      }
    });
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">Images</h2>
        <p className="text-small text-muted">
          The first image is the one shown in the collection grid.
        </p>
      </div>

      {images.length === 0 ? (
        <p className="text-body text-muted">
          No images yet — the site shows a branded placeholder until you add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {images.map((image, index) => (
            <li key={image.id} className="flex items-center gap-2">
              <div className="w-16 shrink-0">
                <ImageFrame
                  src={image.url}
                  alt={image.alt}
                  ratio="1/1"
                  sizes="80px"
                  rounded="field"
                />
              </div>

              <p className="min-w-0 flex-1 truncate text-small text-muted">
                {image.alt || <span className="italic">No alt text</span>}
              </p>

              <div className="flex shrink-0 gap-1">
                <IconButton
                  label={`Move image ${index + 1} up`}
                  disabled={index === 0 || pending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-icon" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move image ${index + 1} down`}
                  disabled={index === images.length - 1 || pending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-icon" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Remove image ${index + 1}`}
                  destructive
                  disabled={pending}
                  onClick={() => remove(image.id)}
                >
                  <Trash2 className="size-icon" aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4 border-t border-line pt-4">
        <Input
          label="Image URL"
          inputMode="url"
          placeholder="https://res.cloudinary.com/…"
          value={url}
          error={error ?? undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
        />
        <Input
          label="Alt text"
          hint="What the picture shows, for screen readers and search."
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
        />
        <Button
          variant="outline"
          size="md"
          onClick={add}
          loading={pending}
          disabled={url.trim() === '' || uploading}
          data-testid="add-image"
        >
          Add from link
        </Button>

        {/* §7.6: "Each slot accepts either a pasted URL or a direct upload." Same for a
            product gallery — the shop photographs pieces on a phone. */}
        <label
          className={
            'flex h-control cursor-pointer items-center justify-center gap-2 rounded-pill ' +
            'bg-ink text-body font-semibold text-white transition-transform duration-fast ' +
            'ease-standard active:scale-[0.98] ' +
            (uploading ? 'pointer-events-none opacity-60' : '')
          }
        >
          <Upload className="size-4" aria-hidden="true" />
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
              // Reset so choosing the same file twice fires a change event again.
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
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
      // 44×44 minimum (MASTER-SPEC §3) — these sit adjacent and a miss deletes an image.
      className={
        'flex size-tap items-center justify-center rounded-pill transition-colors duration-fast ease-standard ' +
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-30 ' +
        (destructive
          ? 'text-muted hover:bg-down/10 hover:text-down'
          : 'text-muted hover:bg-taupe-lt/50 hover:text-ink')
      }
    >
      {children}
    </button>
  );
}
