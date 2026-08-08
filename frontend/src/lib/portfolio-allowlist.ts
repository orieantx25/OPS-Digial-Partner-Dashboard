import { normalizeEmail } from '@/lib/portfolio-jwt';

function decodeAllowlistRaw(): string {
  const b64 = process.env.ALLOWED_EMAIL_HASHES_B64?.trim();
  if (b64) {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  return process.env.ALLOWED_EMAIL_HASHES?.trim() ?? '';
}

export function parseAllowedHashes(): string[] {
  const raw = decodeAllowlistRaw();
  if (!raw) return [];
  return raw.split(',').map((h) => h.trim()).filter(Boolean);
}

export async function verifyEmailAllowlist(email: string): Promise<boolean> {
  const hashes = parseAllowedHashes();
  if (!hashes.length) return false;
  const bcrypt = await import('bcryptjs');
  const normalized = normalizeEmail(email);
  for (const hash of hashes) {
    if (await bcrypt.compare(normalized, hash)) return true;
  }
  return false;
}

export async function hashEmailForAllowlist(email: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(normalizeEmail(email), 10);
}

/** Portal admins who may upload / refresh sheets when a backend is available. */
export function parsePortalAdminEmails(): string[] {
  const raw = process.env.PORTAL_ADMIN_EMAILS?.trim() ?? '';
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => normalizeEmail(e))
    .filter((e) => e.includes('@'));
}

export function isPortalAdminEmail(email: string): boolean {
  const admins = parsePortalAdminEmails();
  if (!admins.length) return false;
  return admins.includes(normalizeEmail(email));
}
