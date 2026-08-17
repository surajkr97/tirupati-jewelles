/**
 * Stage 5D — a media slot may not claim to be on the site unless something reads it.
 *
 * §7.6 planned eleven surfaces; the application renders two. For three phases `/admin/media`
 * told the owner where each slot appeared — "Below the hero, above the rates", "Behind the
 * footer", "The about page", which is not a route that exists — and ten of those twelve
 * promises were false. An upload to them is accepted, validated, audited, stored and shown
 * to nobody.
 *
 * `SlotDefinition.live` is the corrected claim. A claim in a data table decays the moment
 * someone wires a slot up (or stops), which is precisely the shape of defect this file
 * exists to catch: it does not trust the flag, it goes and looks.
 *
 * The check is a source scan rather than a render, because "is this slot read anywhere" is a
 * question about the whole application and there is no single page that would answer it. The
 * same argument `lib/navigation.test.ts` makes for resolving hrefs against the real `app/`
 * tree instead of against a list somebody maintained by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MEDIA_SLOTS, slotSupportsVideo } from '@/lib/media/slots';

const ROOT = resolve(__dirname, '../..');

/** Where application code lives. */
const SEARCH_ROOTS = ['app', 'components', 'lib'];

/**
 * Files whose mention of a slot key does not make it live.
 *
 *  - `slots.ts` is the table under test.
 *  - the seed CREATES the rows; a row with no reader is exactly the case in question.
 *  - tests and the admin UI itself talk about every slot by definition.
 */
const NOT_A_CONSUMER = [
  'lib/media/slots.ts',
  'lib/media/slots.test.ts',
  'app/admin/media/page.tsx',
  'components/admin/media-slot-card.tsx',
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry))) continue;
    if (entry.includes('.test.')) continue;

    const rel = relative(ROOT, full);
    if (NOT_A_CONSUMER.includes(rel)) continue;

    out.push(full);
  }
  return out;
}

const SOURCES = SEARCH_ROOTS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map(
  (file) => ({
    path: relative(ROOT, file),
    text: readFileSync(file, 'utf8'),
  }),
);

describe('every media slot is honest about whether it is on the site', () => {
  it.each(MEDIA_SLOTS.map((slot) => [slot.key, slot.live] as const))(
    '%s',
    (key, live) => {
      const readers = SOURCES.filter((file) => file.text.includes(key)).map(
        (file) => file.path,
      );

      if (live) {
        expect(
          readers,
          `${key} is marked live but nothing outside the media admin reads it`,
        ).not.toHaveLength(0);
      } else {
        expect(
          readers,
          `${key} is now read by ${readers.join(', ')} — set live: true and give it a truthful "where"`,
        ).toHaveLength(0);
      }
    },
  );

  it('a slot that is not live says so rather than naming a place on the site', () => {
    for (const slot of MEDIA_SLOTS) {
      if (slot.live) continue;
      expect(slot.where, `${slot.key} still describes a location`).toBe(
        'Not shown on the site yet',
      );
    }
  });

  it('the two live slots are the homepage hero and the invoice logo', () => {
    // Stated rather than derived: if this number changes, it should change deliberately.
    expect(MEDIA_SLOTS.filter((slot) => slot.live).map((slot) => slot.key)).toEqual([
      'HERO_BANNER',
      'BILL_LOGO',
    ]);
  });
});

/**
 * D-126 — video is a hero-only capability, and the helper is a permission check.
 *
 * `saveMediaSlot` calls `slotSupportsVideo` rather than trusting the form, because the
 * action is reachable directly. A slot storing a video nothing renders is not a security
 * problem, but it is data the owner cannot see and cannot explain.
 */
describe('slotSupportsVideo', () => {
  it('is true for the hero and nothing else', () => {
    const withVideo = MEDIA_SLOTS.filter((slot) => slot.supportsVideo).map((s) => s.key);
    expect(withVideo).toEqual(['HERO_BANNER']);
  });

  it('agrees with the slot table for every key', () => {
    for (const slot of MEDIA_SLOTS) {
      expect(slotSupportsVideo(slot.key), slot.key).toBe(slot.supportsVideo);
    }
  });

  it('says no to a key it does not recognise', () => {
    // A permission helper that answers "yes" to an unknown subject is the wrong shape,
    // even where `isKnownSlot` already ran first.
    expect(slotSupportsVideo('NOT_A_SLOT')).toBe(false);
  });

  it('only offers video where something renders it', () => {
    for (const slot of MEDIA_SLOTS) {
      if (!slot.supportsVideo) continue;
      expect(slot.live, `${slot.key} offers video but nothing renders it`).toBe(true);
    }
  });
});
