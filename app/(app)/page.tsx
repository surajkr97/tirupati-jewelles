/**
 * Homepage placeholder.
 * Created by Phase 1, restyled by Phase 2 to sit inside the storefront shell.
 *
 * Phase 4 §4.5 replaces this with the real homepage: hero → rate ticker → offer strip →
 * categories → featured products → calculator CTA → trust strip.
 */
import { Section } from '@/components/shell';
import { Button, Card } from '@/components/ui';

export default function HomePage() {
  return (
    <Section>
      <Card className="mx-auto flex max-w-160 flex-col items-center gap-6 text-center">
        <span className="text-small font-medium tracking-[0.08em] text-taupe uppercase">
          Coming soon
        </span>
        <h1 className="text-h1 font-semibold text-ink">Tirupati Jewelles</h1>
        <p className="text-body text-muted">
          Today&rsquo;s gold and silver rates, a multi-item price calculator, and
          hallmark-certified jewellery. The storefront is being rebuilt.
        </p>
        <Button variant="accent">Notify me</Button>
      </Card>
    </Section>
  );
}
