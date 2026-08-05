/**
 * /policies/[slug] — buyback and exchange.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2).
 *
 * §6.2 requires the trust block to carry "purity guarantee, buyback and exchange policy
 * links". Those links were pointing at 404s, which is worse than not linking at all — a
 * dead policy link on a page whose job is reassurance does the opposite of reassure.
 *
 * ── What this page deliberately does NOT do ──
 * It does not state terms. Buyback percentages, deduction rules and exchange windows are
 * the shop owner's commercial and legal commitments, and inventing plausible-sounding ones
 * would be fabricating a contract on their behalf. What is written here is only what the
 * site can truthfully say today: the policy exists, it is confirmed in store, and here is
 * how to ask.
 *
 * The owner supplies the real copy before launch — tracked as DEBT-018. Phase 7's admin
 * panel is the natural home for it.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PolicyEnquiry } from '@/components/product/policy-enquiry';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';

export const revalidate = 600;

type Params = Promise<{ slug: string }>;

const POLICIES = {
  buyback: {
    title: 'Buyback policy',
    lede: 'We buy back the pieces we sell.',
    points: [
      'We buy back our own hallmarked pieces at the prevailing rate on the day of the exchange.',
      'Bring the piece and its original bill. The bill records the weight and purity we sold you, which is what the buyback is assessed against.',
      'The applicable deductions depend on the piece and its condition, and are explained in full before anything is agreed.',
    ],
  },
  exchange: {
    title: 'Exchange policy',
    lede: 'Exchange one piece for another, against its current value.',
    points: [
      'Any hallmarked piece bought from us can be exchanged towards another.',
      'The value applied is based on the current rate for its metal and purity, assessed in store.',
      'Bring the piece and its original bill.',
    ],
  },
} as const;

type PolicySlug = keyof typeof POLICIES;

function isPolicySlug(slug: string): slug is PolicySlug {
  return slug in POLICIES;
}

export function generateStaticParams() {
  return Object.keys(POLICIES).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isPolicySlug(slug)) return { title: 'Not found' };

  return { title: POLICIES[slug].title, description: POLICIES[slug].lede };
}

export default async function PolicyPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!isPolicySlug(slug)) notFound();

  const policy = POLICIES[slug];

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex max-w-[70ch] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            {policy.title}
          </h1>
          <p className="text-lead text-muted">{policy.lede}</p>
        </div>

        <Card className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-3 pl-5 text-body text-ink">
            {policy.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Card>

        {/*
          Stated plainly rather than buried. A customer reading a policy page wants to know
          whether they are reading the terms — and right now they are not.
        */}
        <p className="text-small text-muted">
          Exact terms are confirmed in store and may vary by piece. Ask us before you buy
          and we will put it in writing on your bill.
        </p>

        <PolicyEnquiry policy={policy.title} />
      </div>
    </Section>
  );
}
