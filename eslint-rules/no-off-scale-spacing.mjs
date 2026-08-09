/**
 * ESLint rule: reject a spacing utility that is not on the §3 scale.
 * Created by Phase 9 (DEBT-032).
 *
 * ── Why this rule has to exist ──
 * Phase 2 §2.1 sets `--spacing: initial` and defines only 0/4/8/16/24/32/48/64px. In
 * Tailwind v4 a utility whose value has no matching `--spacing-*` key does not fall back to
 * anything and does not warn: it emits **no CSS at all**. `gap-3` leaves `gap: normal`,
 * `px-3` leaves padding at `0`, `h-32` leaves the element at its content height. The source
 * reads as though the element is spaced and the browser disagrees, silently.
 *
 * DESIGN's mandate in AGENTS.md is to "reject any hardcoded hex, px radius, or arbitrary
 * spacing value in a PR". Review missed 45 of them across Phases 6, 7 and 8, which is the
 * argument for a rule rather than a habit — the same reasoning §9.1 used for its
 * Zod-schema-per-route test: a checklist item decays, a test does not.
 *
 * ── The allowed set is PARSED from globals.css, not restated here ──
 * A hardcoded copy of the scale would be a second source of truth, free to drift from the
 * stylesheet the browser actually loads — and a rule that is wrong about the design system
 * is worse than no rule. Phase 2's contrast suite established this pattern by parsing the
 * same file.
 *
 * ── What is deliberately NOT flagged ──
 * Arbitrary values (`px-[20px]`) are explicit: MASTER-SPEC §3 names the 20px gutter and the
 * 80px desktop section padding, and D-006 confines them to `Container` and `Section`.
 * Keyword values (`w-full`, `max-w-prose`, `h-screen`) come from other scales that Phase 2
 * did not disable. Fractions (`w-1/2`) likewise. Only a bare number is checked, because a
 * bare number is the one form that resolves through `--spacing-*` and silently vanishes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Utilities whose bare-number value resolves through `--spacing-*` in Tailwind v4.
 *
 * Longest first, so `max-w` is matched before `w` and `gap-x` before `gap`.
 */
const SPACING_UTILITIES = [
  'scroll-mt',
  'scroll-mb',
  'scroll-ml',
  'scroll-mr',
  'scroll-pt',
  'scroll-pb',
  'scroll-pl',
  'scroll-pr',
  'translate-x',
  'translate-y',
  'space-x',
  'space-y',
  'inset-x',
  'inset-y',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'gap-x',
  'gap-y',
  'basis',
  'indent',
  'inset',
  'start',
  'size',
  'gap',
  'top',
  'right',
  'bottom',
  'left',
  'end',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'w',
  'h',
  'p',
  'm',
];

const UTILITY_PATTERN = new RegExp(`^-?(${SPACING_UTILITIES.join('|')})-(.+)$`);

/** Every `--spacing-<key>` defined in the stylesheet. Parsed once per lint run. */
function allowedKeys() {
  const css = readFileSync(resolve(HERE, '../app/globals.css'), 'utf8');
  const keys = new Set();
  for (const match of css.matchAll(/--spacing-([\w-]+)\s*:/g)) keys.add(match[1]);
  return keys;
}

const ALLOWED = allowedKeys();

/** A bare number — `3`, `2.5`. The only form that resolves through the spacing scale. */
const BARE_NUMBER = /^\d+(\.\d+)?$/;

function offScaleTokens(value) {
  const found = [];

  for (const raw of value.split(/\s+/)) {
    if (raw === '') continue;

    // Strip variants: `md:hover:gap-3` → `gap-3`. The last segment is the utility.
    const utility = raw.slice(raw.lastIndexOf(':') + 1);

    const match = UTILITY_PATTERN.exec(utility);
    if (!match) continue;

    const [, , scaleValue] = match;
    if (!BARE_NUMBER.test(scaleValue)) continue;
    if (ALLOWED.has(scaleValue)) continue;

    found.push({ token: raw, utility: match[1], value: scaleValue });
  }

  return found;
}

/** Pull every string literal out of a className value or a `cn(...)` argument list. */
function stringsIn(node, out) {
  if (!node) return out;

  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push(node);
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) {
        out.push({ ...quasi, value: quasi.value.cooked ?? quasi.value.raw });
      }
      break;
    case 'JSXExpressionContainer':
      stringsIn(node.expression, out);
      break;
    case 'ConditionalExpression':
      stringsIn(node.consequent, out);
      stringsIn(node.alternate, out);
      break;
    case 'LogicalExpression':
      stringsIn(node.left, out);
      stringsIn(node.right, out);
      break;
    case 'BinaryExpression':
      stringsIn(node.left, out);
      stringsIn(node.right, out);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) stringsIn(element, out);
      break;
    case 'CallExpression':
      for (const argument of node.arguments) stringsIn(argument, out);
      break;
    case 'ObjectExpression':
      // `cn({ 'gap-3': isOpen })` — the KEY carries the classes.
      for (const property of node.properties) {
        if (property.type === 'Property' && property.key?.type === 'Literal') {
          stringsIn(property.key, out);
        }
      }
      break;
    default:
      break;
  }

  return out;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Reject Tailwind spacing utilities that have no matching --spacing-* token, because they emit no CSS.',
    },
    schema: [],
    messages: {
      offScale:
        '`{{token}}` is off the §3 spacing scale, so it emits NO CSS — `{{utility}}` will not be applied at all. Use {{nearest}}, or an arbitrary value if MASTER-SPEC §3 names the figure (DEBT-032).',
    },
  },

  create(context) {
    /**
     * A `className={cn('gap-3', …)}` is visited twice — once as the attribute, once as the
     * call — and reporting the same token twice makes the sweep list lie about how many
     * defects there are. Keyed on position, not on node identity, because the template-quasi
     * branch above rebuilds its nodes.
     */
    const reported = new Set();

    function check(nodes) {
      for (const node of nodes) {
        for (const hit of offScaleTokens(node.value)) {
          const seen = `${node.range?.[0]}:${hit.token}`;
          if (reported.has(seen)) continue;
          reported.add(seen);

          context.report({
            node,
            messageId: 'offScale',
            data: {
              token: hit.token,
              utility: hit.utility,
              nearest: nearestOnScale(hit.utility, Number(hit.value)),
            },
          });
        }
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return;
        check(stringsIn(node.value, []));
      },

      // `cn(...)` outside JSX — variant maps in components/ui, and class strings built in
      // a helper and passed down. Phase 8's `input.tsx` defect lived in exactly that shape.
      CallExpression(node) {
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'cn') return;
        check(stringsIn(node, []));
      },
    };
  },
};

/** Suggest the neighbours on the scale, so the message says what to do, not just what is wrong. */
function nearestOnScale(utility, value) {
  const numeric = [...ALLOWED]
    .filter((key) => BARE_NUMBER.test(key))
    .map(Number)
    .sort((a, b) => a - b);

  const below = [...numeric].reverse().find((n) => n < value);
  const above = numeric.find((n) => n > value);

  return [below, above]
    .filter((n) => n !== undefined)
    .map((n) => `\`${utility}-${n}\``)
    .join(' or ');
}

const plugin = { rules: { 'no-off-scale-spacing': rule } };

export default plugin;
