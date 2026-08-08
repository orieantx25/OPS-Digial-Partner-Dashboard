#!/usr/bin/env node
/**
 * Hash emails for ALLOWED_EMAIL_HASHES (Vercel env).
 *
 * Usage:
 *   node scripts/hash-allowlist-emails.mjs email1@example.com email2@example.com
 *   node scripts/hash-allowlist-emails.mjs --file emails.txt
 *
 * Never commit the plain email file.
 */
import { readFileSync } from 'fs';
import bcrypt from 'bcryptjs';

function normalize(email) {
  return email.trim().toLowerCase();
}

async function hashOne(email) {
  return bcrypt.hash(normalize(email), 10);
}

const args = process.argv.slice(2);
let emails = [];

if (args[0] === '--file' && args[1]) {
  const text = readFileSync(args[1], 'utf8');
  emails = text
    .split(/[\r\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e && e.includes('@'));
} else {
  emails = args.filter((e) => e.includes('@'));
}

if (!emails.length) {
  console.error('No emails provided.');
  process.exit(1);
}

const hashes = await Promise.all(emails.map(hashOne));
const joined = hashes.join(',');
console.log('ALLOWED_EMAIL_HASHES_B64=' + Buffer.from(joined, 'utf8').toString('base64'));
console.log('\nPaste ALLOWED_EMAIL_HASHES_B64 into env (Vercel or .env.local).');
console.log('Do not use raw ALLOWED_EMAIL_HASHES — $ in bcrypt breaks dotenv expansion.');
