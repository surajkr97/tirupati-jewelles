/**
 * /policies/[slug] — buyback, exchange, and §9.6's legal pages.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2); extended by Phase 9 §9.6.
 *
 * §6.2 requires the trust block to carry "purity guarantee, buyback and exchange policy
 * links". Those links were pointing at 404s, which is worse than not linking at all — a
 * dead policy link on a page whose job is reassurance does the opposite of reassure.
 *
 * ── What this page deliberately does NOT do ──
 * It states no commercial numbers. Buyback percentages, deduction rules and exchange windows
 * are the shop's commitments, and inventing plausible-sounding ones would be fabricating a
 * contract on their behalf. What is written here is only what the site can truthfully say.
 *
 * **DEBT-018 is closed on the owner's decision (Phase 9): general policy only, no
 * shop-specific terms.** So the buyback and exchange copy IS the policy rather than a
 * placeholder. Every sentence is a claim a customer may rely on; keep it true.
 *
 * ── §9.6's four legal pages, and the line drawn through them ──
 * §9.6 requires privacy, terms, refund/exchange and shipping. They are written to a stricter
 * rule than the two above, because a privacy policy is not reassurance copy — it is a
 * statement of fact about a system, and a wrong one is a lie told at scale:
 *
 *   **Everything on the privacy page describes what this application actually does**, read
 *   off the implementation rather than off a template. Argon2id password hashing (§3.1),
 *   OTP codes stored hashed with a 5-minute TTL (§3.2), an opaque session id in Redis rather
 *   than a JWT (§3.3), the enquiry log keyed by an HMAC rather than by the session itself
 *   (SEC-013), invoices retained indefinitely (DEBT-003, the owner's decision, which Indian
 *   GST rules require for at least six years anyway — DEBT-026). No cookie banner is claimed
 *   because there are no analytics or advertising cookies to consent to.
 *
 *   **The shipping page says the shop does not ship**, because it does not. That is not a
 *   placeholder; DEBT-034 records the same fact from the tax side — every bill is split
 *   CGST/SGST, which is only correct for an intra-state counter sale.
 *
 *   **There is no invented refund window.** For an over-the-counter jeweller the buyback and
 *   exchange policies ARE the route by which a piece comes back, and the refunds page says so
 *   and points at them. If the owner wants a distinct cash-refund policy with a window and
 *   conditions, that is theirs to state — DEBT-043.
 *
 * The two sentences that commit the shop rather than describe the system — "we do not sell
 * your details" and "we do not ship" — are flagged for the owner in SIGNOFF, because they
 * are true of the build and only the owner can ratify them as policy.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PolicyEnquiry } from '@/components/product/policy-enquiry';
import { getShopContact } from '@/lib/settings';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { canonical } from '@/lib/seo';

export const revalidate = 600;

type Params = Promise<{ slug: string }>;

interface PolicySection {
  heading?: string;
  points: string[];
}

interface Policy {
  title: string;
  lede: string;
  sections: PolicySection[];
  /** Small print under the card. Omitted where it would not be true. */
  footnote?: string;
  /** The WhatsApp CTA. Off where the page is informational rather than a conversation. */
  enquiry?: boolean;
}

const POLICIES: Record<string, Policy> = {
  buyback: {
    title: 'Buyback policy',
    lede: 'We buy back the pieces we sell.',
    sections: [
      {
        points: [
          'We buy back our own hallmarked pieces at the prevailing rate on the day of the exchange.',
          'Bring the piece and its original bill. The bill records the weight and purity we sold you, which is what the buyback is assessed against.',
          'The applicable deductions depend on the piece and its condition, and are explained in full before anything is agreed.',
        ],
      },
    ],
    footnote:
      'Exact terms are confirmed in store and may vary by piece. Ask us before you buy and we will put it in writing on your bill.',
    enquiry: true,
  },

  exchange: {
    title: 'Exchange policy',
    lede: 'Exchange one piece for another, against its current value.',
    sections: [
      {
        points: [
          'Any hallmarked piece bought from us can be exchanged towards another.',
          'The value applied is based on the current rate for its metal and purity, assessed in store.',
          'Bring the piece and its original bill.',
        ],
      },
    ],
    footnote:
      'Exact terms are confirmed in store and may vary by piece. Ask us before you buy and we will put it in writing on your bill.',
    enquiry: true,
  },

  refunds: {
    title: 'Refunds',
    lede: 'A piece comes back through buyback or exchange, assessed in store.',
    sections: [
      {
        points: [
          'Every sale is completed in store, over the counter. Nothing is bought or paid for on this website.',
          'If you want to return a piece, the routes are our buyback policy and our exchange policy — both are assessed against the weight and purity recorded on your original bill.',
          'Bring the piece and the bill. We will tell you what it is worth today before anything is agreed.',
        ],
      },
      {
        heading: 'If something is wrong with the piece',
        points: [
          'A manufacturing fault or a hallmark that does not match your bill is our problem to put right, not a buyback. Bring it in and we will deal with it directly.',
        ],
      },
    ],
    footnote:
      'This page describes how a piece is taken back. It does not state a cash-refund window, because the shop sets that in store, case by case.',
    enquiry: true,
  },

  shipping: {
    title: 'Shipping and collection',
    lede: 'We do not ship. Every piece is collected in store.',
    sections: [
      {
        points: [
          'This website is a catalogue, a rate board and a price calculator. It does not take orders and does not deliver.',
          'When you enquire about a piece, the conversation moves to WhatsApp and the purchase happens over the counter.',
          'Your bill is raised in store at the time of sale, and a copy is sent to the number you give us.',
        ],
      },
    ],
    enquiry: true,
  },

  privacy: {
    title: 'Privacy',
    lede: 'What this site stores about you, and why.',
    sections: [
      {
        heading: 'What we collect',
        points: [
          'If you create an account: your phone number or email address, and a password.',
          'If we raise a bill for you: your name, your phone number, and the pieces on that bill.',
          'If you tap “Enquire on WhatsApp”: which piece you were looking at, and when. This is recorded against a one-way identifier, not against your account.',
          'Nothing else. There is no analytics service, no advertising network, and no third-party tracker on this site — which is why you are not being asked to accept cookies.',
        ],
      },
      {
        heading: 'How it is stored',
        points: [
          'Passwords are hashed with Argon2id and are never stored in a form anyone can read, including us.',
          'One-time codes sent to you are stored hashed, expire after five minutes, and can be used once.',
          'Signing in sets one cookie. It holds a random identifier and nothing about you; it is marked HttpOnly and Secure so it cannot be read by a script.',
        ],
      },
      {
        heading: 'How long we keep it',
        points: [
          'Invoices are kept indefinitely. Indian GST rules require invoice records to be retained for several years, and we keep them rather than deleting on a schedule.',
          'Your account exists until you ask us to remove it. Ask, and we will.',
          'One-time codes are deleted as soon as they expire or are used.',
        ],
      },
      {
        heading: 'Who else sees it',
        points: [
          'We do not sell your details, and we do not share them with anyone for marketing.',
          'Product photographs are served by an image hosting provider. That provider sees the request for the image, as it would for any website.',
          'Messages you send us go through WhatsApp, and WhatsApp’s own privacy terms apply to them.',
        ],
      },
    ],
    footnote:
      'To see what we hold about you, correct it, or have it removed, message us. Ask for the bills we hold and we will send them.',
    enquiry: true,
  },

  terms: {
    title: 'Terms of use',
    lede: 'What this website is, and what it is not.',
    sections: [
      {
        heading: 'Prices',
        points: [
          'Every price on this site is indicative. It is calculated from a rate the shop sets, and the rate moves.',
          'The price you pay is the one confirmed in store at the time of sale and printed on your bill. Nothing shown here is a quotation.',
          'The calculator and the price on a product page use the shop’s current rate. The moving figure on the home page is an indicative display and is not used to price anything.',
        ],
      },
      {
        heading: 'Buying',
        points: [
          'You cannot buy anything on this site. There is no basket, no checkout and no payment.',
          'An enquiry is not an order and does not reserve a piece.',
          'A sale happens in store and is recorded on a bill, which is the agreement between us.',
        ],
      },
      {
        heading: 'The catalogue',
        points: [
          'Weights, purities and hallmark details shown here are those recorded for the piece. The piece itself, and the bill, are what govern.',
          'Photographs are of the piece or of pieces like it. Handmade work varies.',
          'We may change or withdraw anything on this site at any time.',
        ],
      },
      {
        heading: 'Your account',
        points: [
          'Keep your password and the codes we send you to yourself. Anyone with them can see your purchase history.',
          'Tell us if you think someone else has got into your account and we will end every session on it.',
        ],
      },
    ],
    footnote:
      'These terms cover the use of this website. The terms of a purchase are the ones agreed in store and set out on your bill.',
    enquiry: true,
  },
};

type PolicySlug = keyof typeof POLICIES;

function isPolicySlug(slug: string): slug is PolicySlug {
  return slug in POLICIES;
}

/** Exported so `lib/seo.test.ts` can assert the sitemap lists exactly these. */
export const POLICY_SLUGS = Object.keys(POLICIES);

export function generateStaticParams() {
  return POLICY_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isPolicySlug(slug)) return { title: 'Not found' };

  return {
    title: POLICIES[slug]!.title,
    description: POLICIES[slug]!.lede,
    ...canonical(`/policies/${slug}`),
  };
}

export default async function PolicyPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!isPolicySlug(slug)) notFound();

  const policy = POLICIES[slug]!;
  // DEBT-050 — `PolicyEnquiry` is a Client Component and cannot read the setting itself.
  const { ownerWhatsApp } = await getShopContact();

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex max-w-[70ch] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            {policy.title}
          </h1>
          <p className="text-lead text-muted">{policy.lede}</p>
        </div>

        {policy.sections.map((section, index) => (
          <Card key={section.heading ?? index} className="flex flex-col gap-4">
            {section.heading && (
              <h2 className="text-h3 font-semibold text-ink">{section.heading}</h2>
            )}
            <ul className="flex list-disc flex-col gap-4 pl-6 text-body text-ink">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </Card>
        ))}

        {/*
          Stated plainly rather than buried. A customer reading a policy page wants to know
          whether they are reading the terms — and on the buyback and exchange pages they
          are not.
        */}
        {policy.footnote && <p className="text-small text-muted">{policy.footnote}</p>}

        {policy.enquiry && (
          <PolicyEnquiry policy={policy.title} ownerWhatsApp={ownerWhatsApp} />
        )}
      </div>
    </Section>
  );
}
