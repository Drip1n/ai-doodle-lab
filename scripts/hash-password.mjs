/**
 * Turns an admin password into the scrypt hash that ADMIN_USERS_JSON wants.
 *
 *   npm run admin:hash-password -- teacher@fontys.nl
 *
 * The password is read from the terminal, never from argv, so it stays out of
 * shell history and out of the process list. Nothing is written to disk.
 */
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../server/admin.mjs';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: npm run admin:hash-password -- you@example.com');
  process.exit(1);
}

const tty = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: tty });
// On a real terminal readline does the echoing, so silencing it is what keeps
// the password off the screen (and off a lecture-hall projector).
if (tty) rl._writeToOutput = () => {};

const ask = async (question) => {
  process.stderr.write(question);
  for await (const line of rl) { process.stderr.write('\n'); return line; }
  throw new Error('No password was given.');
};

const password = await ask('Admin password (not echoed): ');
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
if (password !== await ask('Repeat password: ')) {
  console.error('The two passwords did not match.');
  process.exit(1);
}
rl.close();

const passwordHash = await hashPassword(password);
console.log('Add this to .env.server.local (single quotes matter -- the hash contains $):\n');
console.log(`ADMIN_USERS_JSON='${JSON.stringify([{ email, passwordHash }])}'`);
console.log('\nFor extra admins, put more objects in the same array.');
console.log(`\nA strong random secret, if you ever need one: ${randomBytes(32).toString('base64url')}`);
