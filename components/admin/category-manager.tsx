/**
 * Category management.
 * Created by Phase 7 (specs/07-admin-panel.md §7.5).
 *
 * §7.5: "CRUD, drag-to-reorder, category image, active toggle. Deleting a category with
 * products is blocked with an explanation and a count."
 *
 * Reorder is up/down buttons, for the same reason as the product gallery: on a phone the
 * drag gesture fights the scroll gesture, and this screen is used one-handed behind a
 * counter. The persisted `sortOrder` is the same either way.
 */
'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  deleteCategory,
  reorderCategories,
  saveCategory,
} from '@/app/admin/categories/actions';
import { Button, Card, Input, toast } from '@/components/ui';

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
}

export function CategoryManager({ categories: initial }: { categories: CategoryRow[] }) {
  const [categories, setCategories] = useState(initial);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        return;
      }
      refresh((rows) => rows.filter((r) => r.id !== row.id));
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
            <Card className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-body font-medium text-ink">{row.name}</p>
                <p className="text-small text-muted">
                  /{row.slug} · {row.productCount}{' '}
                  {row.productCount === 1 ? 'piece' : 'pieces'}
                  {!row.isActive && ' · hidden'}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
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
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={pending}
                  aria-pressed={row.isActive}
                  className="h-tap shrink-0 rounded-pill px-4 text-small font-semibold text-ink ring-1 ring-line ring-inset disabled:opacity-40"
                >
                  {row.isActive ? 'On' : 'Off'}
                </button>
                <IconButton
                  label={`Delete ${row.name}`}
                  destructive
                  disabled={pending}
                  onClick={() => remove(row)}
                >
                  <Trash2 className="size-icon" aria-hidden="true" />
                </IconButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="flex flex-col gap-4">
        <Input
          label="New collection"
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
