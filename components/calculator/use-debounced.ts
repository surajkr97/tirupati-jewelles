/**
 * Hold a value still for `delay` ms after it stops changing.
 * Created by Phase 5 (specs/05-calculator.md §5.3); extracted for reuse by Phase 8 §8.1.
 *
 * §5.3: "Debounce recalculation by 150ms while typing."
 *
 * The debounce is not there for the arithmetic — pricing is microseconds. It stops the
 * grand total flickering through nonsense as someone types "1", "12", "125" on the way to
 * "12.5", and it stops the count-up animation restarting on every keystroke. The bill
 * builder shows the same running total and needs the same behaviour.
 */
'use client';

import { useEffect, useState } from 'react';

/** §5.3's figure, shared so the two screens cannot settle on different ones. */
export const DEBOUNCE_MS = 150;

export function useDebounced<T>(value: T, delay: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
