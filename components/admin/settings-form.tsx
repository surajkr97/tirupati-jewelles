/**
 * Shop settings.
 * Created by Phase 7 (specs/07-admin-panel.md §7.9).
 *
 * The password field is at the bottom, next to Save, rather than at the top. §7 SECURITY
 * asks for re-authentication on this screen, and asking for it *before* the owner has typed
 * anything trains them to enter it reflexively — which is the habit the control exists to
 * prevent. Asked at the point of commitment, it is a deliberate act.
 */
'use client';

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
    billSequence: number;
    tickerJitter: 'default' | 'on' | 'off';
    businessHours: string;
    holidayNotice: string;
  };
  /** What NEXT_PUBLIC_TICKER_JITTER is set to, so "Default" can say what it means. */
  envJitter: boolean;
}

export function SettingsForm({ initial, envJitter }: SettingsFormProps) {
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
        setError({ message: result.error, field: result.field });
        return;
      }
      // Never keep it around after a successful save.
      setPassword('');
      toast('Settings saved');
    });
  };

  const fieldError = (field: string) =>
    error?.field === field ? error.message : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Shop</h2>
        <Input
          label="Shop name"
          value={form.shopName}
          error={fieldError('shopName')}
          onChange={(e) => set('shopName', e.target.value)}
        />
        <Input
          label="Address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
        <Input
          label="GSTIN"
          value={form.gstin}
          onChange={(e) => set('gstin', e.target.value)}
        />
        <Input
          label="Contact phone"
          inputMode="tel"
          value={form.contactPhone}
          onChange={(e) => set('contactPhone', e.target.value)}
        />
        <Input
          label="WhatsApp number"
          inputMode="tel"
          hint="Digits only, with the country code — 919876543210."
          value={form.ownerWhatsApp}
          onChange={(e) => set('ownerWhatsApp', e.target.value)}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Defaults</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="GST"
            inputMode="decimal"
            suffix="%"
            value={form.defaultGstPct}
            error={fieldError('defaultGstPct')}
            onChange={(e) => set('defaultGstPct', e.target.value)}
          />
          <Input
            label="Making"
            inputMode="decimal"
            suffix="%"
            value={form.defaultMakingPct}
            error={fieldError('defaultMakingPct')}
            onChange={(e) => set('defaultMakingPct', e.target.value)}
          />
        </div>
        {/* DEBT-001: the GST treatment of making charges is not settled. The field is here
            because §7.9 asks for it; the note is here because nothing in this repo is tax
            advice. */}
        <p className="text-small text-muted">
          GST is applied to the metal value plus making charges. Confirm this treatment
          with your accountant before relying on it.
        </p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Bills</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Prefix"
            value={form.billPrefix}
            onChange={(e) => set('billPrefix', e.target.value)}
          />
          <Input
            label="Next number"
            inputMode="numeric"
            value={String(form.billSequence)}
            error={fieldError('billSequence')}
            onChange={(e) => set('billSequence', Number(e.target.value) || 1)}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Homepage rate ticker</h2>
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
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-ink">Notices</h2>
        <Input
          label="Business hours"
          value={form.businessHours}
          onChange={(e) => set('businessHours', e.target.value)}
        />
        <Input
          label="Holiday notice"
          hint="Shown as a banner while it is filled in."
          value={form.holidayNotice}
          onChange={(e) => set('holidayNotice', e.target.value)}
        />
      </Card>

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

        {error && !error.field && (
          <p
            role="alert"
            className="rounded-field bg-down/10 px-4 py-3 text-small text-down"
          >
            {error.message}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          full
          loading={pending}
          onClick={submit}
          disabled={password.trim() === ''}
          data-testid="save-settings"
        >
          Save settings
        </Button>
      </Card>
    </div>
  );
}
