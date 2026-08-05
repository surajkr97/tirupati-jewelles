/**
 * Where the shared admin cookie jar lives.
 *
 * A plain module rather than an export from `admin.setup.ts`, because Playwright refuses to
 * let one test file import another — and both the setup that writes it and the spec that
 * reads it need the path.
 */
export const ADMIN_STATE = 'test-results/.admin-auth.json';
