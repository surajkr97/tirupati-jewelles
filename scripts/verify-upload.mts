/**
 * Verify the Cloudinary upload path against the real account.
 * Created by Phase 7 (specs/07-admin-panel.md §7.8, §7 SECURITY).
 *
 *   pnpm verify:upload
 *
 * §7 SECURITY names two upload cases that cannot be proven with a mock, because what is
 * being tested is whether *Cloudinary* rejects them:
 *
 *   "Upload a `.php`/`.html` renamed to `.jpg` → rejected by magic-byte check."
 *   "Upload a 100MB file → rejected before buffering."
 *
 * This uploads real bytes with the real signature and reports what came back. It exists as
 * a script rather than a test because it needs live credentials and costs a network round
 * trip — the same reasoning as `scripts/verify-production-guard.sh`, which checks a thing
 * only a production build can show.
 *
 * Everything it creates, it deletes.
 */
import { createHash, randomUUID } from 'node:crypto';

import { config } from 'dotenv';

/**
 * Config comes through `lib/env.ts`, not `process.env`.
 *
 * Reading the environment directly here would have needed a new ESLint exemption, and the
 * Phase 1 rule forbidding it is right: a second place that reads configuration is a second
 * place that can disagree with the schema. This script asserts the real upload path, so it
 * must see exactly the values the application sees.
 *
 * `.env` is loaded first and the module imported dynamically, because `lib/env.ts` parses
 * at import time and `tsx` does not load `.env` on its own — a static import would throw
 * before dotenv had run.
 */
config({ path: '.env', quiet: true });

const { env } = await import('../lib/env');

const CLOUD = env.CLOUDINARY_CLOUD_NAME;
const KEY = env.CLOUDINARY_API_KEY;
const SECRET = env.CLOUDINARY_API_SECRET;

if (!CLOUD || !KEY || !SECRET) {
  console.error(
    'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env.',
  );
  process.exit(1);
}

/** Must mirror lib/media/upload.ts. If these drift, the script proves nothing. */
const FOLDER = 'tirupati/products';
const FORMATS = 'jpg,jpeg,png,webp,avif';
const EAGER = 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400';

/**
 * `resource_type` is NOT in the signed set — Cloudinary excludes `file`, `cloud_name`,
 * `api_key` and `resource_type`, and including one yields `Invalid Signature` with no clue
 * which. That cost a debugging round; it is written down so it does not cost another.
 */
function sign(params: Record<string, string | number>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${canonical}${SECRET}`).digest('hex');
}

const created: string[] = [];

async function attempt(label: string, bytes: Buffer, filename: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = randomUUID();

  const signed: Record<string, string | number> = {
    allowed_formats: FORMATS,
    eager: EAGER,
    eager_async: 'true',
    folder: FOLDER,
    image_metadata: 'false',
    invalidate: 'true',
    public_id: publicId,
    timestamp,
  };

  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(bytes)]), filename);
  body.append('api_key', KEY!);
  body.append('timestamp', String(timestamp));
  body.append('signature', sign(signed));
  for (const [key, value] of Object.entries(signed)) {
    if (key !== 'timestamp') body.append(key, String(value));
  }

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: 'POST',
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    secure_url?: string;
    error?: { message?: string };
  };

  if (response.ok && json.secure_url) created.push(`${FOLDER}/${publicId}`);

  return {
    accepted: response.ok,
    status: response.status,
    message: json.error?.message ?? '',
    url: json.secure_url,
  };
}

interface AttemptResult {
  accepted: boolean;
  status: number;
  message: string;
  url?: string;
}

function report(label: string, result: AttemptResult, wantAccepted: boolean) {
  const pass = result.accepted === wantAccepted;
  const verdict = result.accepted ? 'ACCEPTED' : 'REJECTED';
  console.log(
    `${pass ? '  ok  ' : ' FAIL '} ${label.padEnd(44)} ${result.status} ${verdict} ${result.message.slice(0, 60)}`,
  );
  return pass;
}

async function destroy(publicId: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy`, {
    method: 'POST',
    body: new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: KEY!,
      signature: sign({ public_id: publicId, timestamp }),
    }),
  });
}

/** A genuine 1×1 PNG. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  console.log(`\nCloudinary upload check — cloud "${CLOUD}"\n`);

  let passed = true;

  // The control. If this fails, nothing below means anything — a blanket rejection would
  // look like perfect security and be a broken feature.
  const good = await attempt(
    'a real PNG (control — must be accepted)',
    REAL_PNG,
    'photo.png',
  );
  passed = report('a real PNG (control)', good, true) && passed;

  if (!good.accepted && good.status === 403) {
    console.log(
      '\n  The key is authenticated but lacks upload permission.\n' +
        '  Cloudinary → Settings → API Keys → this key → Roles: it needs an\n' +
        '  upload-capable role (Technical Admin). Media Library User cannot create.\n',
    );
    process.exit(1);
  }

  // §7 SECURITY, case 1.
  passed =
    report(
      'a .php renamed .jpg',
      await attempt('php', Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.jpg'),
      false,
    ) && passed;

  passed =
    report(
      'an .html renamed .jpg',
      await attempt(
        'html',
        Buffer.from('<html><script>alert(1)</script></html>'),
        'x.jpg',
      ),
      false,
    ) && passed;

  // An SVG is a real image format, and deliberately outside the allowlist: it can carry
  // script, and it is served from a domain we control.
  passed =
    report(
      'an SVG (outside the signed allowlist)',
      await attempt(
        'svg',
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        'x.svg',
      ),
      false,
    ) && passed;

  // §7 SECURITY, case 2. 12MB of PNG-headed noise: past the 10MB cap, and the header means
  // it is the SIZE being rejected rather than the format.
  const oversized = Buffer.concat([REAL_PNG, Buffer.alloc(12 * 1024 * 1024, 0x41)]);
  passed =
    report(
      'a 12MB file (over the 10MB cap)',
      await attempt('big', oversized, 'huge.png'),
      false,
    ) && passed;

  // Tampering: the client trying to keep EXIF and escape the folder. Both fields are inside
  // the signature, so changing either must invalidate it.
  {
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = randomUUID();
    const honest: Record<string, string | number> = {
      allowed_formats: FORMATS,
      eager: EAGER,
      eager_async: 'true',
      folder: FOLDER,
      image_metadata: 'false',
      invalidate: 'true',
      public_id: publicId,
      timestamp,
    };

    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(REAL_PNG)]), 'photo.png');
    body.append('api_key', KEY!);
    body.append('timestamp', String(timestamp));
    body.append('signature', sign(honest));
    for (const [key, value] of Object.entries(honest)) {
      if (key !== 'timestamp') body.append(key, String(value));
    }
    body.set('image_metadata', 'true');
    body.set('folder', 'somewhere/else');

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`,
      {
        method: 'POST',
        body,
      },
    );
    const json = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    passed =
      report(
        'tampered params (keep EXIF, change folder)',
        {
          accepted: response.ok,
          status: response.status,
          message: json.error?.message ?? '',
        },
        false,
      ) && passed;
  }

  for (const publicId of created) await destroy(publicId);
  if (created.length > 0) console.log(`\ncleaned up ${created.length} test asset(s)`);

  console.log(passed ? '\nAll checks passed.\n' : '\nSome checks FAILED.\n');
  process.exit(passed ? 0 : 1);
}

void main();
