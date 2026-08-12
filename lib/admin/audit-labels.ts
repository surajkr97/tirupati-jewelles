/**
 * Human labels for audit actions.
 * Created by the UI redesign, Stage 5F (brief §14).
 *
 * §7.10 stores `action` as a free string and every writer passes a constant like
 * `PRODUCT_IMAGE_REORDER`. The screen showed those constants verbatim, so reading the log
 * meant translating SCREAMING_SNAKE_CASE in your head, twenty times a page.
 *
 * §14 is precise about the boundary: "The UI may provide a human-readable label, but the
 * underlying event semantics must remain unchanged." So nothing here renames an event. The
 * stored string is the key, the stored string is what the filter submits, and the stored
 * string stays visible beside the label — an engineer matching a row to the code that wrote
 * it must not have to guess which sentence corresponds to which constant.
 *
 * `lib/admin/audit-labels.test.ts` scans the repository for every `action:` a writer passes
 * and fails if one has no label here. A lookup table that silently falls back is a table that
 * quietly stops covering half the log.
 */

/** Every action written by an `adminAction` caller, and how it reads to a person. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  RATE_SET: 'Rate changed',

  PRODUCT_CREATE: 'Piece added',
  PRODUCT_EDIT: 'Piece edited',
  PRODUCT_DEACTIVATE: 'Piece hidden',
  PRODUCT_BULK: 'Pieces changed in bulk',
  PRODUCT_IMAGE_ADD: 'Photo added from a link',
  PRODUCT_IMAGE_UPLOAD: 'Photo uploaded',
  PRODUCT_IMAGE_REMOVE: 'Photo removed',
  PRODUCT_IMAGE_REORDER: 'Photos reordered',

  CATEGORY_CREATE: 'Collection added',
  CATEGORY_EDIT: 'Collection edited',
  CATEGORY_DELETE: 'Collection deleted',
  CATEGORY_REORDER: 'Collections reordered',

  MEDIA_SET: 'Site image changed',

  ORDER_CREATE: 'Bill raised',
  ORDER_CLAIM: 'Order claimed by a customer',
  BILL_SEND: 'Bill marked as sent',
  BILL_VOID: 'Bill voided',
  BILL_PDF_REGENERATE: 'Invoice re-rendered',

  SETTINGS_UPDATE: 'Settings changed',
};

/**
 * The label, or the raw token when there is none.
 *
 * Falling back to the stored string rather than to "Unknown": a log that hides an action it
 * has no wording for is worse than one that shows the constant, and the test above is what
 * stops the fallback becoming the normal case.
 */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/**
 * One field that changed, as the log will show it.
 *
 * `before` and `after` are curated by each writer — none of them carries a password, a token
 * or a session id, and §16 asks that the screen not dump raw JSON regardless. This reduces
 * the pair to "what actually differs", which is the question an auditor is asking.
 */
export interface AuditChange {
  key: string;
  from: string | null;
  to: string | null;
}

/** How many fields a single row will show before it stops. */
export const MAX_CHANGES_SHOWN = 6;

/** How long a single value may print before it is clipped. */
const MAX_VALUE_LENGTH = 60;

/**
 * Render one JSON value as a short string.
 *
 * Deliberately shallow. An array becomes a count and an object becomes a marker, because the
 * two payloads that carry them — `PRODUCT_BULK`'s id list and `CATEGORY_REORDER`'s order —
 * are long, unreadable and not what anybody is scanning the log for. The full record is still
 * in the database for anyone who needs it.
 */
function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }
  if (typeof value === 'object') return '…';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  const text = String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/** A readable label for a payload key — `ownerWhatsApp` → `owner whats app` reads badly. */
const KEY_LABEL: Record<string, string> = {
  isActive: 'visible',
  isFeatured: 'featured',
  ratePerGram: 'rate per gram',
  weightMg: 'weight (mg)',
  makingPct: 'making %',
  stoneCharge: 'stone charge',
  grandTotal: 'total',
  sentViaWa: 'sent on WhatsApp',
  sentAt: 'sent at',
  voidedAt: 'voided at',
  imageUrl: 'image',
  linkUrl: 'link',
  billPrefix: 'invoice prefix',
  billSequence: 'next invoice number',
  ownerWhatsApp: 'WhatsApp number',
  shopName: 'shop name',
  tickerJitter: 'ticker movement',
};

function keyLabel(key: string): string {
  return KEY_LABEL[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * The difference between a `before` and an `after` payload.
 *
 * Keys whose value did not change are dropped: a `SETTINGS_UPDATE` records six fields and
 * usually one of them moved, so showing all six buries the answer. A create has no `before`
 * and every key counts as new.
 */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const from = isRecord(before) ? before : {};
  const to = isRecord(after) ? after : {};

  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  const changes: AuditChange[] = [];

  for (const key of keys) {
    const left = renderValue(from[key]);
    const right = renderValue(to[key]);
    if (left === right) continue;

    changes.push({ key: keyLabel(key), from: left, to: right });
  }

  return changes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
