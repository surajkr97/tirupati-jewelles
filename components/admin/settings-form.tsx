/**
 * Shop settings.
 * Created by Phase 7 (specs/07-admin-panel.md §7.9), redesigned by Stage 5F.
 *
 * The password field is at the bottom, next to Save, rather than at the top. §7 SECURITY
 * asks for re-authentication on this screen, and asking for it *before* the owner has typed
 * anything trains them to enter it reflexively — which is the habit the control exists to
 * prevent. Asked at the point of commitment, it is a deliberate act.
 *
 * ── Stage 5F: every setting says what it changes ──
 *
 * §3 asks that each field communicate its name, what it controls, its current value and its
 * unit. Phase 7's form was a stack of bare labels — "Prefix", "Next number", "GST" — on a
 * screen where three of the fields change what customers are charged, what prints on a legal
 * document, and which number the next invoice gets. Only GST had a sentence under it.
 *
 * Nothing about `saveSettings` changed: same Zod schema, same re-authentication, same audit
 * entry, same two cache invalidations.
 *
 * ── The two high-impact fields warn only when they are actually being changed (§6) ──
 *
 * A permanent red banner over GST is furniture; the eye stops seeing it by the third visit.
 * The warnings below appear the moment the value differs from what is stored and say what
 * the new value will do, which is the only moment either is worth reading.
 */
'use client';

import { AlertTriangle } from 'lucide-react';
import { useState, useTransition } from 'react';

import { saveSettings } from '@/app/admin/settings/actions';
import { Button, Card, Input, Select, toast } from '@/components/ui';

export interface SettingsFormProps {
  initial: {
    shopName: string;
    address: string;
    gstin: string;
    contactPhone: string;
    ownerWhatsApp: string;
    defaultGstPct: string;
    defaultMakingPct: string;
    billPrefix: string;
    billSequence: string;
    tickerJitter: 'default' | 'on' | 'off';
    businessHours: string;
    holidayNotice: string;
  };
  /** What NEXT_PUBLIC_TICKER_JITTER is set to, so "Default" can say what it means. */
  envJitter: boolean;
  /**
   * Which fields have never been written to the settings row.
   *
   * §7: "Do not invent fallback values that could be mistaken for configured business
   * values. If a setting is not configured: make that state explicit." The WhatsApp number
   * in particular falls back to `NEXT_PUBLIC_OWNER_WA`, so the form showed a real number
   * that was not in the database and nothing said so.
   */
  unset: { gstin: boolean; ownerWhatsApp: boolean; address: boolean };
}

export function SettingsForm({ initial, envJitter, unset }: SettingsFormProps) {
  const [form, setForm] = useState(initial);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveSettings({ ...form, password });
      if (!result.ok) {
        // §5 — the typed values stay exactly where they are. Only the password is dropped.
        setError({ message: result.error, field: result.field });
        return;
      }
      // Never keep it around after a successful save.
      setPassword('');
      setSaved(form);
      toast('Settings saved');
    });
  };

  /** What the database holds, so Save can say whether there is anything to save (§5). */
  const [saved, setSaved] = useState(initial);

  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined;

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some(
    (key) => form[key] !== saved[key],
  );

  const gstChanged = form.defaultGstPct !== saved.defaultGstPct;
  const sequenceChanged = form.billSequence !== saved.billSequence;
  const prefixChanged = form.billPrefix !== saved.billPrefix;

  return (
    <div className="flex flex-col gap-6">
      <Group
        title="Shop"
        description="Printed on every invoice and used wherever the site names or links to you."
      >
        <Input
          label="Shop name"
          hint="The heading on your invoices."
          value={form.shopName}
          error={fieldError('shopName')}
          onChange={(e) => set('shopName', e.target.value)}
        />
        <Input
          label="Address"
          hint={
            unset.address
              ? 'Not set. Invoices print without an address until you add one.'
              : 'Printed under the shop name on every invoice.'
          }
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
        <Input
          label="GSTIN"
          hint={
            unset.gstin
              ? 'Not set. Your invoices are printing without a GSTIN.'
              : 'Printed on every invoice as your tax registration.'
          }
          value={form.gstin}
          onChange={(e) => set('gstin', e.target.value)}
        />
        <Input
          label="Contact phone"
          inputMode="tel"
          hint="Shown to customers as the shop's number."
          value={form.contactPhone}
          onChange={(e) => set('contactPhone', e.target.value)}
        />
        <Input
          label="WhatsApp number"
          inputMode="tel"
          hint={
            unset.ownerWhatsApp
              ? 'Not saved yet — this is the number built into the site. Every WhatsApp button uses it. Digits only, with the country code: 919876543210.'
              : 'Every WhatsApp button on the site opens a chat with this number. Digits only, with the country code — 919876543210.'
          }
          value={form.ownerWhatsApp}
          onChange={(e) => set('ownerWhatsApp', e.target.value)}
        />
      </Group>

      {/* §4 — the two figures that decide what a customer pays. */}
      <Group
        title="Pricing defaults"
        description="Applied to new pieces and to the customer's calculator. They do not change a bill that has already been raised."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="GST"
            inputMode="decimal"
            suffix="%"
            hint="Percentage, 0–100. Currently 3% for gold and silver jewellery."
            value={form.defaultGstPct}
            error={fieldError('defaultGstPct')}
            onChange={(e) => set('defaultGstPct', e.target.value)}
          />
          <Input
            label="Making"
            inputMode="decimal"
            suffix="%"
            hint="Percentage, 0–100. Prefilled on a new piece; each piece can differ."
            value={form.defaultMakingPct}
            error={fieldError('defaultMakingPct')}
            onChange={(e) => set('defaultMakingPct', e.target.value)}
          />
        </div>

        {/* The treatment is confirmed (DEBT-001 closed), so this states it rather than
            asking the owner to go and check. */}
        <p className="text-small text-muted">
          GST is applied to the metal value plus making charges, as confirmed with your
          accountant.
        </p>

        {gstChanged && (
          <Warning>
            GST goes from <Figure>{saved.defaultGstPct}%</Figure> to{' '}
            <Figure>{form.defaultGstPct}%</Figure>. Every price on the site, every
            calculator result and every new bill uses the new rate as soon as this saves.
            Bills already raised keep the rate they were charged at.
          </Warning>
        )}
      </Group>

      <Group
        title="Invoice numbering"
        description="How the next invoice number is built. Numbers already issued never change."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Prefix"
            hint="Letters, numbers and hyphens. Appears as PREFIX-YEAR-NUMBER."
            value={form.billPrefix}
            error={fieldError('billPrefix')}
            onChange={(e) => set('billPrefix', e.target.value)}
          />
          <Input
            label="Next invoice number"
            inputMode="numeric"
            hint="The number the next bill will take."
            value={form.billSequence}
            error={fieldError('billSequence')}
            onChange={(e) => set('billSequence', e.target.value)}
          />
        </div>

        <p className="text-small text-muted">
          Next invoice:{' '}
          <span className="font-medium text-ink num">
            {form.billPrefix || '…'}-{new Date().getFullYear()}-
            {(form.billSequence || '1').padStart(4, '0')}
          </span>
        </p>

        {/* §6 — the one setting on this screen that can produce two invoices with the same
            number, which is a compliance problem rather than a cosmetic one. */}
        {sequenceChanged && (
          <Warning>
            The next bill will be numbered <Figure>{form.billSequence}</Figure> instead of{' '}
            <Figure>{saved.billSequence}</Figure>. Moving this backwards can reissue a
            number that is already on a customer&rsquo;s invoice, and invoice numbers have to
            be unique for six years.
          </Warning>
        )}
        {prefixChanged && (
          <Warning>
            New bills will be numbered <Figure>{form.billPrefix}-…</Figure> instead of{' '}
            <Figure>{saved.billPrefix}-…</Figure>. Bills already raised keep their own
            numbers, so your invoice book will contain both.
          </Warning>
        )}
      </Group>

      <Group title="Homepage rate ticker">
        <Select
          label="Live movement"
          value={form.tickerJitter}
          onChange={(e) =>
            set('tickerJitter', e.target.value as typeof form.tickerJitter)
          }
        >
          <option value="default">
            Follow the site setting ({envJitter ? 'on' : 'off'})
          </option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </Select>
        {/*
          MASTER-SPEC §8: the off-switch is the insurance for showing an indicative price.
          §7.9 asks for it in the UI so it can be thrown without a deploy — so the copy says
          plainly what it does rather than describing an animation setting.
        */}
        <p className="text-small text-muted">
          When on, the homepage rate moves slightly each second so it feels live. The
          calculator, product pages and bills always use your real rate. Switch it off if
          you would rather show the flat rate.
        </p>
      </Group>

      <Group
        title="Notices"
        description="Shown to customers on the storefront. Leave either blank to show nothing."
      >
        <Input
          label="Business hours"
          hint="Free text, e.g. “Mon–Sat, 10am–8pm”."
          value={form.businessHours}
          onChange={(e) => set('businessHours', e.target.value)}
        />
        <Input
          label="Holiday notice"
          hint="Shown as a banner across the site while it is filled in."
          value={form.holidayNotice}
          onChange={(e) => set('holidayNotice', e.target.value)}
        />
      </Group>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Confirm it is you</h2>
        <p className="text-small text-muted">
          These settings appear on your bills and control how customers reach you, so they
          need your password again.
        </p>
        <Input
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={fieldError('password')}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />

        {/* §7 — a failure that belongs to no field still has to be announced. */}
        {error && !error.field && (
          <p
            role="alert"
            className="rounded-field bg-down/10 px-4 py-4 text-small text-down"
          >
            {error.message}
          </p>
        )}

        {/*
          §5 — the button reports whether there is anything to save, the way the rate editor
          and the product form do (D-086). It still needs the password: re-authentication is
          the point of this screen, so an empty password keeps it disabled even when the form
          is dirty, and the label says which of the two is missing.
        */}
        {/*
          A disabled button that does not say why is the one thing somebody cannot work
          around — the same gap Stage 5E closed on the bill builder's Generate. Here there
          are exactly two reasons, and only one of them can be true at a time worth saying.
        */}
        {dirty && password.trim() === '' && (
          <p className="text-small text-muted">
            Enter your password above to save these changes.
          </p>
        )}

        <Button
          variant={dirty && password.trim() !== '' ? 'primary' : 'outline'}
          size="lg"
          full
          loading={pending}
          loadingLabel="Saving…"
          onClick={submit}
          disabled={!dirty || password.trim() === ''}
          data-testid="save-settings"
        >
          {!dirty ? 'No changes' : 'Save settings'}
        </Button>
      </Card>
    </div>
  );
}

/** One titled group of settings. §3: "Do not put every setting into one giant form." */
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">{title}</h2>
        {description && <p className="text-small text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/**
 * A consequence, shown only while the value that causes it is actually changed.
 *
 * `role="status"` rather than `alert`: it appears as somebody types, and an assertive live
 * region would interrupt a screen-reader user mid-field on every keystroke.
 */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-field bg-down/10 p-4 text-small text-ink"
    >
      <AlertTriangle className="size-4 shrink-0 text-down" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Figure({ children }: { children: React.ReactNode }) {
  return <strong className="num">{children}</strong>;
}
