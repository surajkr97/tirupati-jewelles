/**
 * Category management.
 * Created by Phase 7 (specs/07-admin-panel.md §7.5), redesigned by Stage 5F.
 *
 * §7.5: "CRUD, drag-to-reorder, category image, active toggle. Deleting a category with
 * products is blocked with an explanation and a count."
 *
 * Reorder is up/down buttons, for the same reason as the product gallery: on a phone the
 * drag gesture fights the scroll gesture, and this screen is used one-handed behind a
 * counter. The persisted `sortOrder` is the same either way.
 *
 * ── Three of §7.5's four capabilities had no UI ──
 *
 * The list could reorder, toggle, create and delete. It could not RENAME — `saveCategory`
 * has taken a name and a slug since Phase 7 and the only caller passed the existing ones
 * back — and it could not set an IMAGE, because the form had no field for the column the
 * storefront reads (UI_REDESIGN_DEBT-014). So every collection tile on the site has shown
 * the branded monogram since Phase 3, permanently, with no admin route to change it.
 *
 * §11's grouping — collection, image, visibility, save — is an inline editor per row rather
 * than a second route: there is no `/admin/categories/[id]`, inventing one would be new
 * routing rather than a redesign, and a collection has four fields.
 *
 * ── Deleting asks first ──
 *
 * §7.5's block only covers a collection that still has pieces in it. An EMPTY one was
 * deleted by a single tap on a trash icon sitting 4px from the reorder controls, with no
 * confirmation — the same defect Stage 5D found in the product gallery, in a place where the
 * row also carries its own web address.
 */
'use client';

import { ArrowDown, ArrowUp, Check, ImageOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { validateImageUrl } from '@/app/admin/media/actions';
import {
  deleteCategory,
  reorderCategories,
  saveCategory,
} from '@/app/admin/categories/actions';
import { Badge, Button, Card, ImageFrame, Input, toast } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  imageUrl: string | null;
  productCount: number;
}

export function CategoryManager({ categories: initial }: { categories: CategoryRow[] }) {
  const [categories, setCategories] = useState(initial);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Which row is open for editing, and which is awaiting a delete confirmation. */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = (updater: (rows: CategoryRow[]) => CategoryRow[]) =>
    setCategories((rows) => updater(rows));

  const add = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveCategory({ name: newName, isActive: true });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh((rows) => [
        ...rows,
        {
          id: result.data.id,
          name: newName.trim(),
          slug: newName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-'),
          isActive: true,
          imageUrl: null,
          productCount: 0,
        },
      ]);
      setNewName('');
      toast('Collection added');
    });
  };

  const toggle = (row: CategoryRow) => {
    setError(null);
    startTransition(async () => {
      // `imageUrl` is deliberately NOT sent: undefined means "leave it alone", and hiding a
      // collection must not clear its picture.
      const result = await saveCategory({
        id: row.id,
        name: row.name,
        slug: row.slug,
        isActive: !row.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh((rows) =>
        rows.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)),
      );
      toast(row.isActive ? `${row.name} hidden` : `${row.name} is visible`);
    });
  };

  const remove = (row: CategoryRow) => {
    setError(null);
    startTransition(async () => {
      const result = await deleteCategory(row.id);
      if (!result.ok) {
        // §7.5's blocked-delete explanation, shown in full rather than as "failed".
        setError(result.error);
        setConfirmDelete(null);
        return;
      }
      refresh((rows) => rows.filter((r) => r.id !== row.id));
      setConfirmDelete(null);
      toast(`${row.name} deleted`);
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;

    const next = [...categories];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);

    const previous = categories;
    setCategories(next);

    startTransition(async () => {
      const result = await reorderCategories(next.map((row) => row.id));
      if (!result.ok) {
        setCategories(previous);
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
          data-testid="category-error"
        >
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {categories.map((row, index) => (
          <li key={row.id}>
            <Card className="flex flex-col gap-4" data-testid="category-row">
              {/*
                The controls drop to their own line below `sm`.

                On one row at 320px the arithmetic does not work: 232px of card interior,
                less a 64px thumbnail, less the gap, less three 44px targets, leaves about
                20px for the text — so `truncate` hid the collection's NAME completely and
                the row showed a slug and a piece count for a collection it would not name.
                Caught by a screenshot; the overflow assertion passed the whole time,
                because everything shrank rather than pushing the page sideways.
              */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {/*
                    §10 — the image, because a collection IS its tile on the homepage, and
                    §9 asks that the admin can see its current state at a glance.
                    `ImageFrame` draws the branded monogram when there is none, which is
                    exactly what the storefront shows.
                  */}
                  <div className="w-16 shrink-0">
                    <ImageFrame
                      src={row.imageUrl}
                      alt=""
                      ratio="1/1"
                      sizes="64px"
                      rounded="field"
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="truncate text-body font-medium text-ink">{row.name}</p>
                    <p className="text-small text-muted">
                      /{row.slug} · <span className="num">{row.productCount}</span>{' '}
                      {row.productCount === 1 ? 'piece' : 'pieces'}
                    </p>
                    {/* §21 — status in words, never colour alone, and only for the state
                        worth flagging. A visible collection is the ordinary case. */}
                    {(!row.isActive || !row.imageUrl) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {!row.isActive && <Badge tone="down">Hidden</Badge>}
                        {!row.imageUrl && (
                          <Badge tone="outline">
                            <ImageOff className="size-4" aria-hidden="true" />
                            No image
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 justify-end gap-1">
                  <IconButton
                    label={`Move ${row.name} up`}
                    disabled={index === 0 || pending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-icon" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move ${row.name} down`}
                    disabled={index === categories.length - 1 || pending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-icon" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={editing === row.id ? `Close ${row.name}` : `Edit ${row.name}`}
                    onClick={() => {
                      setEditing((current) => (current === row.id ? null : row.id));
                      setConfirmDelete(null);
                      setError(null);
                    }}
                  >
                    <Pencil className="size-icon" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              {editing === row.id && (
                <CategoryEditor
                  row={row}
                  busy={pending}
                  onSaved={(patch) => {
                    refresh((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)),
                    );
                  }}
                  onError={setError}
                  onToggle={() => toggle(row)}
                  onAskDelete={() => setConfirmDelete(row.id)}
                  confirmingDelete={confirmDelete === row.id}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onConfirmDelete={() => remove(row)}
                />
              )}
            </Card>
          </li>
        ))}
      </ul>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Add a collection</h2>
        <Input
          label="New collection"
          hint="A picture and its web address can be set once it exists."
          value={newName}
          onChange={(event) => {
            setNewName(event.target.value);
            setError(null);
          }}
        />
        <Button
          variant="outline"
          size="md"
          onClick={add}
          loading={pending}
          loadingLabel="Adding…"
          disabled={newName.trim() === ''}
          data-testid="add-category"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add collection
        </Button>
      </Card>
    </div>
  );
}

/**
 * §11's grouping: collection → image → visibility → save.
 *
 * A local component rather than a file of its own: it has one caller, it shares that
 * caller's row type, and §23 is explicit about not creating admin-only duplicates without a
 * reason. The same argument Stage 5D made for keeping the product form's toggle local.
 */
function CategoryEditor({
  row,
  busy,
  onSaved,
  onError,
  onToggle,
  onAskDelete,
  confirmingDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  row: CategoryRow;
  busy: boolean;
  onSaved: (patch: Partial<CategoryRow>) => void;
  onError: (message: string | null) => void;
  onToggle: () => void;
  onAskDelete: () => void;
  confirmingDelete: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [slug, setSlug] = useState(row.slug);
  const [imageUrl, setImageUrl] = useState(row.imageUrl ?? '');
  const [saved, setSaved] = useState({
    name: row.name,
    slug: row.slug,
    imageUrl: row.imageUrl ?? '',
  });

  /** Only ever a server-validated URL — the same rule the media slot card follows. */
  const [preview, setPreview] = useState<string | null>(row.imageUrl);
  const [imageError, setImageError] = useState<string | null>(null);
  const [confirmRemoveImage, setConfirmRemoveImage] = useState(false);
  const [checking, startChecking] = useTransition();
  const [saving, startSaving] = useTransition();

  const dirty =
    name !== saved.name || slug !== saved.slug || imageUrl !== saved.imageUrl;

  /**
   * `validateImageUrl` is imported from the media actions rather than copied.
   *
   * It takes a URL and returns what `checkImageUrl` verified — nothing about it is specific
   * to a media slot, it is already `adminAction`-guarded, and §23 asks for reuse over an
   * admin-only duplicate. The alternative was a second server action doing the same thing.
   */
  const check = () => {
    setImageError(null);
    startChecking(async () => {
      const result = await validateImageUrl(imageUrl);
      if (!result.ok) {
        setPreview(null);
        setImageError(result.error);
        return;
      }
      setImageUrl(result.data.url);
      setPreview(result.data.url);
      toast(
        `Looks good — ${result.data.format.toUpperCase()}, ${Math.round(result.data.bytes / 1024)} KB`,
      );
    });
  };

  const save = () => {
    onError(null);
    setImageError(null);
    startSaving(async () => {
      const result = await saveCategory({
        id: row.id,
        name,
        slug,
        isActive: row.isActive,
        imageUrl,
      });

      if (!result.ok) {
        if (result.field === 'imageUrl') setImageError(result.error);
        else onError(result.error);
        return;
      }

      setSaved({ name, slug, imageUrl });
      setPreview(imageUrl || null);
      onSaved({ name, slug, imageUrl: imageUrl || null });
      toast(`${name} saved`);
    });
  };

  const removeImage = () => {
    onError(null);
    setImageError(null);
    startSaving(async () => {
      const result = await saveCategory({
        id: row.id,
        name: saved.name,
        slug: saved.slug,
        isActive: row.isActive,
        imageUrl: '',
      });

      if (!result.ok) {
        onError(result.error);
        return;
      }

      setImageUrl('');
      setPreview(null);
      setSaved((current) => ({ ...current, imageUrl: '' }));
      setConfirmRemoveImage(false);
      onSaved({ imageUrl: null });
      toast(`Image removed from ${saved.name}`);
    });
  };

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-4">
      <div className="flex flex-col gap-4">
        <h3 className="text-body font-semibold text-ink">Collection</h3>
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
        <Input
          label="Web address"
          hint={`Customers reach this at /collections/${slug || '…'}. Changing it breaks any link already shared.`}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          maxLength={80}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-body font-semibold text-ink">Image</h3>
          <p className="text-small text-muted">
            The tile shown for this collection on the homepage and the collections page.
            Without one the site draws its branded frame.
          </p>
        </div>

        {/*
          `max-w-3xs` (256px), not an arbitrary pixel value.

          The editor tries to autocorrect `max-w-[240px]` to `max-w-admin-rail`, because
          `--spacing-admin-rail` happens to be 240px — the same false equivalence that
          rewrote a 20px gutter to `px-icon` in Stage 4. A keyword from the width scale is
          not on the spacing scale at all, so nothing can mistake it for the sidebar.
        */}
        <div className="max-w-3xs">
          <ImageFrame
            src={preview}
            alt={preview ? `Current image for ${saved.name}` : ''}
            ratio="1/1"
            sizes="256px"
            rounded="field"
          />
        </div>

        <Input
          label="Image URL"
          inputMode="url"
          placeholder="https://res.cloudinary.com/…"
          hint="Paste an https link from an allowed image host, then check it."
          value={imageUrl}
          error={imageError ?? undefined}
          onChange={(event) => {
            setImageUrl(event.target.value);
            setImageError(null);
            setConfirmRemoveImage(false);
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={check}
            loading={checking}
            loadingLabel="Checking…"
            disabled={imageUrl.trim() === '' || saving}
            data-testid={`check-category-image-${row.id}`}
          >
            <Check className="size-4" aria-hidden="true" />
            Check &amp; preview
          </Button>

          {saved.imageUrl !== '' && !confirmRemoveImage && (
            <Button
              variant="ghost"
              size="sm"
              className="text-down hover:bg-down/10"
              disabled={saving}
              onClick={() => setConfirmRemoveImage(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove image
            </Button>
          )}
        </div>

        {/* §12 — the confirmation names the collection, not "this image". */}
        {confirmRemoveImage && (
          <div
            className="flex flex-col gap-4 rounded-field bg-down/10 p-4"
            data-testid={`remove-image-confirm-${row.id}`}
          >
            <p className="text-small text-ink">
              Remove the image from <strong>{saved.name}</strong>? The collection stays; its
              tile goes back to the branded frame until you add another.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmRemoveImage(false)}
              >
                Keep it
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-down hover:bg-down/90"
                loading={saving}
                loadingLabel="Removing…"
                onClick={removeImage}
                data-testid={`confirm-remove-image-${row.id}`}
              >
                Remove image
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-body font-semibold text-ink">Visibility</h3>
        <div className="flex items-center justify-between gap-4">
          <p className="text-small text-muted">
            {row.isActive
              ? 'On the site. Customers can browse this collection.'
              : 'Hidden. Its pieces stay in the catalogue but the collection is off the site.'}
          </p>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            role="switch"
            aria-checked={row.isActive}
            aria-label={`${row.name} visible on the site`}
            className={cn(
              'flex h-tap w-16 shrink-0 items-center rounded-pill',
              'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
              'disabled:opacity-40',
            )}
          >
            <span
              className={cn(
                'relative h-8 w-full rounded-pill transition-colors duration-fast ease-standard',
                row.isActive ? 'bg-rose-deep' : 'bg-line',
              )}
            >
              <span
                className={cn(
                  'absolute top-1 left-1 size-6 rounded-pill bg-white shadow-card',
                  'transition-transform duration-base ease-standard',
                  row.isActive ? 'translate-x-8' : 'translate-x-0',
                )}
              />
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-line pt-4">
        {/* The rate editor's rule (D-086): full strength only when there is work to do. */}
        <Button
          variant={dirty ? 'primary' : 'outline'}
          size="md"
          full
          disabled={!dirty}
          loading={saving}
          loadingLabel="Saving…"
          onClick={save}
          data-testid={`save-category-${row.id}`}
        >
          {dirty ? 'Save changes' : 'No changes'}
        </Button>

        {!confirmingDelete ? (
          <Button
            variant="ghost"
            size="md"
            className="text-muted hover:bg-down/10 hover:text-down"
            disabled={busy || saving}
            onClick={onAskDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete this collection
          </Button>
        ) : (
          <div
            className="flex flex-col gap-4 rounded-field bg-down/10 p-4"
            data-testid={`delete-confirm-${row.id}`}
          >
            {/*
              Named, and honest about what happens next.

              A collection holding pieces cannot be deleted at all — `deleteCategory` refuses
              with a count and a way out — so the only case reaching this button is an empty
              one, and saying so is more useful than a warning that will not apply.
            */}
            <p className="text-small text-ink">
              Delete <strong>{row.name}</strong>?
              {row.productCount > 0 ? (
                <>
                  {' '}
                  It still has <span className="num">{row.productCount}</span>{' '}
                  {row.productCount === 1 ? 'piece' : 'pieces'} in it, so this will be
                  refused — hide it instead.
                </>
              ) : (
                <> It is empty, so this removes it and its web address for good.</>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelDelete}>
                Keep it
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-down hover:bg-down/90"
                loading={busy}
                loadingLabel="Deleting…"
                onClick={onConfirmDelete}
                data-testid={`confirm-delete-${row.id}`}
              >
                Delete {row.name}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={
        'flex size-tap items-center justify-center rounded-pill transition-colors duration-fast ease-standard ' +
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-30 ' +
        'text-muted hover:bg-rose-tint hover:text-ink'
      }
    >
      {children}
    </button>
  );
}
