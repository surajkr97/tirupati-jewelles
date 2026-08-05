/**
 * @vitest-environment jsdom
 *
 * Phase 2 TEST: "Render test per primitive, all variants" plus the keyboard and focus
 * requirements from specs/02-design-system.md.
 *
 * Written against the spec's acceptance criteria, not the implementation — per AGENTS.md,
 * reading the implementation to decide what to assert produces a tautology.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageFrame } from '@/components/ui/image-frame';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

afterEach(cleanup);

describe('Button', () => {
  it.each(['primary', 'accent', 'outline', 'ghost'] as const)(
    'renders %s variant',
    (v) => {
      render(<Button variant={v}>Label</Button>);
      expect(screen.getByRole('button', { name: 'Label' })).toBeInTheDocument();
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders %s size', (s) => {
    render(<Button size={s}>Label</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('is disabled and announces busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button', { name: /Saving/ });

    // A loading button that can still be pressed submits the form twice.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );

    await userEvent.click(screen.getByRole('button'), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('caller className overrides the variant default rather than colliding', () => {
    render(<Button className="bg-up">Override</Button>);
    // Compare exact class tokens: a substring check would match `hover:bg-ink/90`, which
    // is a different property context and is meant to survive.
    const classes = screen.getByRole('button').className.split(/\s+/);

    expect(classes).toContain('bg-up');
    expect(classes).not.toContain('bg-ink');
  });
});

describe('Input', () => {
  it('associates its label with the control', () => {
    render(<Input label="Weight" />);
    expect(screen.getByLabelText('Weight')).toBeInTheDocument();
  });

  it('exposes inputMode so mobile shows the right keyboard', () => {
    render(<Input label="Weight" inputMode="decimal" />);
    expect(screen.getByLabelText('Weight')).toHaveAttribute('inputmode', 'decimal');
  });

  it('announces the error and marks the field invalid', () => {
    render(<Input label="Email" error="Enter a valid email." />);
    const field = screen.getByLabelText('Email');

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email.');
    // The message must be linked, or a screen reader never reaches it.
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('prefers the error over the hint when both are supplied', () => {
    render(<Input label="Phone" hint="We send an OTP." error="Invalid number." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid number.');
    expect(screen.queryByText('We send an OTP.')).not.toBeInTheDocument();
  });

  it('renders the unit suffix without it being announced', () => {
    render(<Input label="Weight" suffix="g" />);
    expect(screen.getByText('g')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Select', () => {
  it('is a native select, not a custom listbox', () => {
    render(
      <Select label="Category">
        <option value="rings">Rings</option>
      </Select>,
    );

    // §2.2: native is better on mobile and gives a11y for free.
    expect(screen.getByLabelText('Category').tagName).toBe('SELECT');
  });
});

describe('SegmentedControl', () => {
  const OPTIONS = [
    { value: 'k22', label: '22K' },
    { value: 'k18', label: '18K' },
    { value: 'silver', label: 'Silver' },
  ] as const;

  function setup(value: string, onChange = vi.fn()) {
    render(
      <SegmentedControl
        label="Metal"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it('exposes a radiogroup with one radio per option', () => {
    setup('k22');
    const group = screen.getByRole('radiogroup', { name: 'Metal' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
  });

  it('marks only the selected option as checked', () => {
    setup('k18');
    expect(screen.getByRole('radio', { name: '18K' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '22K' })).not.toBeChecked();
  });

  it('uses a roving tabindex so the group is a single tab stop', () => {
    setup('k18');
    expect(screen.getByRole('radio', { name: '18K' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '22K' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection with ArrowRight', async () => {
    const onChange = setup('k22');
    screen.getByRole('radio', { name: '22K' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('k18');
  });

  it('wraps from the last option back to the first', async () => {
    const onChange = setup('silver');
    screen.getByRole('radio', { name: 'Silver' }).focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('k22');
  });

  it('supports Home and End', async () => {
    const onChange = setup('k18');
    screen.getByRole('radio', { name: '18K' }).focus();

    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('silver');

    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('k22');
  });

  it('selects on click', async () => {
    const onChange = setup('k22');
    await userEvent.click(screen.getByRole('radio', { name: 'Silver' }));
    expect(onChange).toHaveBeenCalledWith('silver');
  });
});

describe('ImageFrame', () => {
  it('renders a branded placeholder instead of a broken image when src is null', () => {
    const { container } = render(<ImageFrame src={null} alt="Gold ring" />);

    expect(container.querySelector('img')).toBeNull();
    // §2.2: the empty slot must look intentional, not like a broken page.
    expect(screen.getByText('TJ')).toBeInTheDocument();
  });

  it('holds a fixed aspect ratio so an empty slot cannot shift layout', () => {
    const { container } = render(<ImageFrame src={null} alt="" ratio="16/9" />);
    expect(container.firstElementChild).toHaveStyle({ aspectRatio: '16/9' });
  });
});

describe('Badge, Card, Spinner, EmptyState', () => {
  it.each(['neutral', 'accent', 'up', 'down', 'outline'] as const)(
    'Badge renders %s tone',
    (tone) => {
      render(<Badge tone={tone}>Label</Badge>);
      expect(screen.getByText('Label')).toBeInTheDocument();
    },
  );

  it('Card has a shadow and never a border', () => {
    const { container } = render(<Card>Body</Card>);
    const cls = container.firstElementChild?.className ?? '';

    expect(cls).toContain('shadow-card');
    expect(cls).not.toMatch(/\bborder\b/);
  });

  it('Spinner exposes an accessible status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });

  it('EmptyState renders title, description and action', () => {
    render(
      <EmptyState
        title="No purchases yet"
        description="Verify your phone to see your history."
        action={<Button>Verify</Button>}
      />,
    );

    expect(screen.getByText('No purchases yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });
});
