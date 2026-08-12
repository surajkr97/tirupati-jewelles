/**
 * Homepage trust band.
 * Created by the UI redesign, Stage 4A (brief §20).
 *
 * ── Every claim here is one the shop can actually keep ──
 *
 * §20 says to use only claims the product supports, and one of the reference image's four
 * does not survive that test. It reads **"Live Updated Rates — Real-time updates"**. This
 * application has no live rate feed: MASTER-SPEC §1 puts "live market rate APIs" out of
 * scope, the rate is typed in by the shop owner in `/admin/rates`, and `RateDisclaimer`
 * exists specifically to say "Indicative rate" everywhere it is shown.
 *
 * `app/layout.tsx` already records the reasoning, in a comment about the site description:
 * *"Deliberately not 'live rates': the ticker shows an admin-set indicative rate, and
 * MASTER-SPEC §8 is explicit that claiming otherwise is the consumer-protection exposure
 * this build is mitigating."* Putting "real-time" in a trust band — the one section on the
 * page whose entire job is to be believed — would be the same false claim in the worst
 * possible place.
 *
 * So the fourth item is **"Rates updated daily"**, which is what the footer has always said
 * and what the shop actually does. The other three restate promises the product already
 * makes: the hallmark block on every product page (§6.2), the itemised bill, and the
 * making charge shown before purchase.
 *
 * ── Why gold is allowed here and nowhere else ──
 *
 * Gold measures 2.27:1 on cream — below even the 3:1 non-text bar — and 6.84:1 on wine
 * (D-057). This band is the wine surface, so it is one of the few places the brand's metal
 * can appear at all. The icons are the jewellery detail the brief asks gold to carry.
 */
import { BadgeCheck, Receipt, Scale, ShieldCheck } from 'lucide-react';

const ITEMS = [
  {
    icon: ShieldCheck,
    title: 'BIS hallmarked',
    detail: 'Certified purity on every piece',
  },
  {
    icon: Scale,
    title: 'Honest making charges',
    detail: 'Shown before you decide',
  },
  {
    icon: Receipt,
    title: 'Transparent pricing',
    detail: 'Itemised, GST included',
  },
  {
    // Not "live". See the file header.
    icon: BadgeCheck,
    title: 'Rates updated daily',
    // NOT "final price confirmed in store": `RateDisclaimer` already says exactly that,
    // and repeating a sentence verbatim two blocks apart reads as filler rather than as
    // reassurance. This says the same true thing from the shop's side.
    detail: 'Set each morning by the shop',
  },
] as const;

export function TrustBand() {
  return (
    <section
      aria-labelledby="trust-heading"
      /* Stage 6: was `surface-wine bg-wine text-cream`. §1 takes wine off the storefront,
         and this band was the second-largest dark field on the page. `sand` keeps it set
         back from the white sections above and below it without going dark. */
      className="bg-sand text-ink"
    >
      <div className="mx-auto w-full max-w-[1200px] px-[20px] py-12 md:px-[40px] md:py-16">
        <h2 id="trust-heading" className="sr-only">
          Why buy from Tirupati J.
        </h2>

        {/*
          A list, not four cards.

          Brief §20 asks this not to look like a generic icon grid, and the difference is
          that these share one surface and are separated by hairlines rather than each
          floating in its own rounded box. One object, four facts.
        */}
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {ITEMS.map(({ icon: Icon, title, detail }) => (
            <li
              key={title}
              className="flex gap-4 lg:flex-col lg:gap-4 lg:border-l lg:border-line lg:pl-6 lg:first:border-l-0 lg:first:pl-0"
            >
              <Icon
                /* Gold was legible on wine and measures 2.27:1 on a light ground (D-057),
                   so it cannot come with the band. `rose` is the accent this palette uses
                   for exactly this — a small non-text mark. */
                className="size-icon shrink-0 text-rose"
                aria-hidden="true"
                strokeWidth={1.5}
              />
              <div className="flex flex-col gap-1">
                <p className="text-body font-medium">{title}</p>
                <p className="text-small text-muted">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
