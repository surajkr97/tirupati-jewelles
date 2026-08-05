/**
 * Password policy.
 * Created by Phase 3 (specs/03-auth.md §3.1).
 *
 * §3.1: "Minimum 8 characters. Check against a top-10k common-password list. Do NOT impose
 * symbol/uppercase rules — they push users toward Password1! and reduce real entropy."
 *
 * The composition rules are deliberately absent. This checks length and guessability only,
 * which is also the current NIST SP 800-63B guidance.
 *
 * See DECISIONS.md D-009 on the size of the blocklist.
 */

export const MIN_PASSWORD_LENGTH = 8;
/** Argon2 hashes the input, but an unbounded field is a cheap DoS — hashing is costly. */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * The passwords that actually appear in credential-stuffing lists, ordered roughly by
 * real-world frequency. Deliberately includes the India-specific entries a generic list
 * misses (`india123`, `bharat`, cricket names) and jewellery-shop-specific guesses an
 * owner might pick.
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '123456789',
  'qwerty',
  'password',
  '12345678',
  '111111',
  '123123',
  '1234567890',
  '1234567',
  'qwerty123',
  '000000',
  '1q2w3e',
  'aa12345678',
  'abc123',
  'password1',
  '1234',
  'qwertyuiop',
  '123321',
  'password123',
  '1q2w3e4r5t',
  'iloveyou',
  '654321',
  '666666',
  '987654321',
  '123',
  '123456a',
  'qwe123',
  '1q2w3e4r',
  '7777777',
  '1qaz2wsx',
  '123qwe',
  'zxcvbnm',
  '121212',
  'asdasd',
  'a123456',
  '555555',
  'dragon',
  'monkey',
  'letmein',
  'sunshine',
  'princess',
  'football',
  'charlie',
  'donald',
  'welcome',
  'admin',
  'admin123',
  'administrator',
  'root',
  'toor',
  'pass',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'secret',
  'master',
  'login',
  'guest',
  'test',
  'test123',
  'demo',
  'changeme',
  'default',
  'temp',
  'temp123',
  'whatever',
  'trustno1',
  'baseball',
  'shadow',
  'superman',
  'batman',
  'jordan',
  'harley',
  'ranger',
  'hunter',
  'buster',
  'soccer',
  'hockey',
  'killer',
  'george',
  'andrew',
  'thomas',
  'robert',
  'jessica',
  'michelle',
  'daniel',
  'ashley',
  'bailey',
  'jennifer',
  'michael',
  'computer',
  'internet',
  'samsung',
  'google',
  'facebook',
  'starwars',
  'freedom',
  'whatever1',
  'matrix',
  'cheese',
  'summer',
  'winter',
  'spring',
  'autumn',
  'january',
  'february',
  'december',
  'money',
  'love',
  'lovely',
  'sweety',
  'flower',
  'hello',
  'hello123',
  'welcome1',
  'welcome123',
  'qazwsx',
  'qwerty1',
  'asdfghjkl',
  'zxcvbn',
  'poiuytrewa',
  'mnbvcxz',
  '1qazxsw2',
  'q1w2e3r4',
  'abcd1234',
  'abcdefgh',
  '11111111',
  '22222222',
  '12341234',
  '10203040',
  '147258369',
  '159357',
  '987654',
  '456789',
  '112233',
  '102030',
  // India-specific — a generic English list misses these entirely.
  'india123',
  'india',
  'bharat',
  'namaste',
  'krishna',
  'ganesh',
  'ganesha',
  'shivshankar',
  'shiva',
  'radhe',
  'radhekrishna',
  'jaimatadi',
  'omnamahshivaya',
  'saibaba',
  'sairam',
  'hanuman',
  'laxmi',
  'lakshmi',
  'durga',
  'ganpati',
  'balaji',
  'tirupati',
  'tirupathi',
  'venkatesh',
  'srinivas',
  'rahul',
  'rahul123',
  'amit',
  'amit123',
  'raj',
  'raja',
  'raju',
  'ravi',
  'ravi123',
  'sunil',
  'anil',
  'vijay',
  'ajay',
  'sanjay',
  'suraj',
  'kumar',
  'kumar123',
  'sharma',
  'singh',
  'singh123',
  'patel',
  'gupta',
  'verma',
  'yadav',
  'khan',
  'sachin',
  'sachin123',
  'dhoni',
  'virat',
  'kohli',
  'rohit',
  'cricket',
  'india@123',
  'mumbai',
  'delhi',
  'chennai',
  'kolkata',
  'bangalore',
  'hyderabad',
  'pune',
  'jaipur',
  'ahmedabad',
  'lucknow',
  'kanpur',
  'nagpur',
  'indore',
  'bhopal',
  'patna',
  'surat',
  // Domain-specific: what a jewellery shop owner might reach for.
  'jewel',
  'jewels',
  'jewellery',
  'jewelry',
  'gold',
  'gold123',
  'silver',
  'silver123',
  'goldsilver',
  'diamond',
  'diamond123',
  'ornament',
  'sona',
  'sonachandi',
  'chandi',
  'shop',
  'shop123',
  'store',
  'store123',
  'billing',
  'invoice',
  'owner',
  'manager',
]);

/** Keyboard runs and simple repeats that a static list cannot enumerate. */
const KEYBOARD_WALKS = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1234567890',
  'qazwsxedc',
  'qwertzuiop',
];

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a candidate password.
 *
 * Returns a single, user-facing reason. Deliberately never says "too similar to X" or
 * echoes the input back.
 */
export function checkPassword(password: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, reason: 'That password is too common. Choose something else.' };
  }

  // Strip trailing digits before re-checking: `password123` and `krishna2024` are the same
  // guess as `password` and `krishna` to anyone running a list.
  const stripped = lower.replace(/[0-9!@#$%^&*]+$/, '');
  if (stripped.length >= 4 && COMMON_PASSWORDS.has(stripped)) {
    return { ok: false, reason: 'That password is too common. Choose something else.' };
  }

  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: 'Avoid a single repeated character.' };
  }

  if (/^\d+$/.test(password)) {
    // Includes dates of birth and phone numbers, the two most common numeric choices.
    return { ok: false, reason: 'Use more than just numbers.' };
  }

  for (const walk of KEYBOARD_WALKS) {
    if (walk.includes(lower) || walk.split('').reverse().join('').includes(lower)) {
      return { ok: false, reason: 'Avoid straight runs of keyboard keys.' };
    }
  }

  return { ok: true };
}
