/**
 * Homepage placeholder.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.7): "/ renders 'Coming soon' — no
 * styling work yet, that's Phase 2."
 *
 * Phase 4 §4.5 replaces this with the real homepage: hero → rate ticker → offer strip →
 * categories → featured products → calculator CTA → trust strip → footer.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Tirupati Jewelles</h1>
      <p className="text-[var(--color-muted)]">Coming soon.</p>
    </main>
  );
}
