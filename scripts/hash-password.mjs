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
import { pathToFileURL } from 'node:url';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../server/admin.mjs';

/**
 * Asks for a password without echoing it, more than once, over one terminal
 * session.
 *
 * `rl.question()` rather than `for await (const line of rl)`: returning early
 * from that async iterator calls its `return()`, which closes the interface,
 * so the second prompt had nothing left to read from.
 */
export function createPasswordPrompt({
  input = process.stdin,
  output = process.stderr,
  terminal = Boolean(input.isTTY),
} = {}) {
  const rl = createInterface({ input, output, terminal });
  // On a terminal readline does the echoing itself, so silencing it is what
  // keeps the password off the screen (and off a lecture-hall projector).
  if (terminal) rl._writeToOutput = () => {};
  let open = true;
  rl.on('close', () => { open = false; });

  return {
    get open() { return open; },
    ask(question) {
      return new Promise((resolve, reject) => {
        if (!open) return reject(new Error('No password was given.'));
        // Written straight to the output, because the muted readline cannot
        // print its own prompt.
        output.write(question);
        let answered = false;
        // Ctrl-D or a closed pipe must fail rather than hang forever on a
        // callback that will never fire.
        const onClose = () => { if (!answered) reject(new Error('No password was given.')); };
        rl.once('close', onClose);
        rl.question('', (answer) => {
          answered = true;
          rl.off('close', onClose);
          output.write('\n');
          resolve(answer);
        });
      });
    },
    close() { rl.close(); },
  };
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error('Usage: npm run admin:hash-password -- you@example.com');
    process.exit(1);
  }

  const prompt = createPasswordPrompt();
  let password;
  try {
    password = await prompt.ask('Admin password (not echoed): ');
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      process.exit(1);
    }
    if (password !== await prompt.ask('Repeat password: ')) {
      console.error('The two passwords did not match.');
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  } finally {
    prompt.close();
  }

  const passwordHash = await hashPassword(password);
  console.log('Add this to .env.server.local (single quotes matter -- the hash contains $):\n');
  console.log(`ADMIN_USERS_JSON='${JSON.stringify([{ email, passwordHash }])}'`);
  console.log('\nFor extra admins, put more objects in the same array.');
  console.log(`\nA strong random secret, if you ever need one: ${randomBytes(32).toString('base64url')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
