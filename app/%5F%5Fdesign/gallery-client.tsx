/**
 * Gallery contents — client component so interactive states are real, not screenshots.
 * Created by Phase 2 (specs/02-design-system.md §2.5).
 */
'use client';

import { PackageOpen } from 'lucide-react';
import { useState } from 'react';

import {
  Badge,
  Button,
  Chip,
  Card,
  EmptyState,
  ImageFrame,
  Input,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Spinner,
  toast,
} from '@/components/ui';
import { COLORS, contrastRatio } from '@/lib/design/tokens';

const METALS = [
  { value: 'k22', label: '22K' },
  { value: 'k18', label: '18K' },
  { value: 'silver', label: 'Silver' },
] as const;

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-h3 font-semibold text-ink">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export function GalleryClient() {
  const [metal, setMetal] = useState<string>('k22');
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <Row title="Colour tokens">
        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {Object.entries(COLORS).map(([name, hex]) => {
            /**
             * Both surfaces, not just cream.
             *
             * The wine/rose palette is the first one here with two page grounds, and a
             * single "on cream" figure actively misleads on half of it — `gold` reads 2.27
             * (unusable) when its whole job is to sit on wine at 6.84. D-057.
             */
            const onCream = contrastRatio(hex, COLORS.cream);
            const onWine = contrastRatio(hex, COLORS.wine);
            return (
              <div key={name} className="flex flex-col gap-2">
                <div
                  className="h-16 w-full rounded-field shadow-card"
                  style={{ backgroundColor: hex }}
                />
                <div className="flex flex-col">
                  <span className="text-small font-medium text-ink">{name}</span>
                  <span className="text-small text-muted num">{hex}</span>
                  <span className="text-small text-muted num">
                    {onCream.toFixed(2)} cream · {onWine.toFixed(2)} wine
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Row>

      <Row title="Buttons — variants">
        <Button variant="primary">Primary</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </Row>

      <Row title="Buttons — sizes, loading, disabled">
        <Button size="sm">Small 44px</Button>
        <Button size="md">Medium 52px</Button>
        <Button size="lg">Large 56px</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
      </Row>

      <Row title="Buttons — full width">
        <Button full variant="accent">
          Enquire on WhatsApp
        </Button>
      </Row>

      {/* The on-wine pair, shown ON wine — the only place their contrast means anything.
          Tab into these: the focus ring must be cream here and ink everywhere else. */}
      <Row title="Buttons — on a wine surface">
        <Card tone="wine" className="flex w-full flex-wrap items-center gap-4">
          <Button variant="onWine">Explore collection</Button>
          <Button variant="onWineOutline">Rate history</Button>
        </Card>
      </Row>

      <Row title="Chip — selectable, 44px, aria-pressed">
        <Chip selected={metal === 'k22'} onClick={() => setMetal('k22')}>
          22K · 916
        </Chip>
        <Chip selected={metal === 'k18'} onClick={() => setMetal('k18')}>
          18K · 750
        </Chip>
        <Chip disabled>Silver 999</Chip>
      </Row>

      <Row title="Type — display serif vs UI sans">
        <div className="flex w-full flex-col gap-4">
          <p className="font-display text-h1-lg font-medium text-ink">
            Every gram, accounted for.
          </p>
          <p className="text-body text-muted">
            Headlines are serif. Navigation, buttons, prices and every numeral stay sans —
            brief §6.
          </p>
          {/* Tabular figures: these two columns must align to the pixel. */}
          <div className="flex gap-8">
            <div className="flex flex-col">
              <span className="text-h2 text-ink num">₹71,240</span>
              <span className="text-h2 text-ink num">₹58,310</span>
              <span className="text-small text-muted">.num — aligned</span>
            </div>
            <div className="flex flex-col">
              <span className="text-h2 text-ink">₹71,240</span>
              <span className="text-h2 text-ink">₹58,310</span>
              <span className="text-small text-muted">without — drifts</span>
            </div>
          </div>
        </div>
      </Row>

      <Row title="Card">
        <Card className="w-full max-w-xs">
          <p className="text-body text-ink">
            Static card — radius 24, shadow, no border.
          </p>
        </Card>
        <Card interactive className="w-full max-w-xs">
          <p className="text-body text-ink">
            Interactive — lifts on hover, presses on tap.
          </p>
        </Card>
      </Row>

      <Row title="Input">
        <div className="w-full max-w-xs">
          <Input label="Weight" placeholder="0.000" inputMode="decimal" suffix="g" />
        </div>
        <div className="w-full max-w-xs">
          <Input label="Making charge" defaultValue="12" inputMode="numeric" suffix="%" />
        </div>
        <div className="w-full max-w-xs">
          <Input label="Phone" hint="We send an OTP to confirm." inputMode="tel" />
        </div>
        <div className="w-full max-w-xs">
          <Input label="Email" defaultValue="not-an-email" error="Enter a valid email." />
        </div>
        <div className="w-full max-w-xs">
          <Input label="Disabled" disabled placeholder="Unavailable" />
        </div>
      </Row>

      <Row title="Select">
        <div className="w-full max-w-xs">
          <Select label="Category" defaultValue="rings">
            <option value="rings">Rings</option>
            <option value="necklaces">Necklaces</option>
            <option value="bangles">Bangles</option>
          </Select>
        </div>
      </Row>

      <Row title="SegmentedControl — arrow-key navigable">
        <div className="w-full max-w-sm">
          <SegmentedControl
            label="Metal and purity"
            options={METALS}
            value={metal}
            onChange={setMetal}
          />
          <p className="mt-2 text-small text-muted">
            Selected: <span className="tabular">{metal}</span>
          </p>
        </div>
      </Row>

      <Row title="Badge">
        <Badge tone="neutral">22K · 916</Badge>
        <Badge tone="accent">Featured</Badge>
        <Badge tone="up">▲ ₹142</Badge>
        <Badge tone="down">▼ ₹87</Badge>
        <Badge tone="outline">Hallmarked</Badge>
      </Row>

      <Row title="Sheet, Toast, Spinner">
        <Button variant="outline" onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <Button variant="outline" onClick={() => toast.success('Rate updated.')}>
          Success toast
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error('Could not reach the server.')}
        >
          Error toast
        </Button>
        <span className="flex h-control items-center gap-2 text-muted">
          <Spinner /> Spinner
        </span>
      </Row>

      <Row title="Skeleton — must match final dimensions exactly">
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Skeleton className="h-8 w-[128px]" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-[96px]" />
        </div>
      </Row>

      <Row title="ImageFrame — empty state must look deliberate">
        <div className="w-full max-w-3xs">
          <ImageFrame src={null} alt="" ratio="1/1" />
          <p className="mt-2 text-small text-muted">No URL — branded placeholder</p>
        </div>
        <div className="w-full max-w-3xs">
          <ImageFrame src={null} alt="" ratio="16/9" rounded="field" />
          <p className="mt-2 text-small text-muted">16/9, field radius</p>
        </div>
      </Row>

      <Row title="EmptyState">
        <Card className="w-full max-w-sm" padded={false}>
          <EmptyState
            icon={<PackageOpen className="size-8" />}
            title="No purchases yet"
            description="If you've bought from us, verify your phone number to see your history."
            action={<Button variant="accent">Verify phone</Button>}
          />
        </Card>
      </Row>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Price breakdown"
        description="Esc to close. Drag down to dismiss. Focus is trapped inside."
      >
        <div className="flex flex-col gap-4">
          <Input label="Focusable field one" />
          <Input label="Focusable field two" />
          <Button full onClick={() => setSheetOpen(false)}>
            Done
          </Button>
        </div>
      </Sheet>
    </>
  );
}
