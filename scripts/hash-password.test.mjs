import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPasswordPrompt } from './hash-password.mjs';

/**
 * Collects everything the prompt writes, so a test can assert that a password
 * never appears there.
 */
function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  const written = [];
  output.on('data', (chunk) => written.push(chunk.toString()));
  return { input, output, text: () => written.join('') };
}

test('it can ask twice over one session, with the second answer typed later', async () => {
  const { input, output } = streams();
  const prompt = createPasswordPrompt({ input, output, terminal: false });
  try {
    // Writing both lines up front would pass even against the old
    // implementation, because readline had already buffered them. A human
    // types the second one only after being asked, and that is what used to
    // fail: returning early from `for await (const line of rl)` closed the
    // interface, so the second prompt had nothing left to read.
    const first = prompt.ask('Admin password (not echoed): ');
    input.write('workshop-pass-1234\n');
    assert.equal(await first, 'workshop-pass-1234');
    assert.equal(prompt.open, true, 'the interface must survive the first answer');

    const second = prompt.ask('Repeat password: ');
    input.write('workshop-pass-1234\n');
    assert.equal(await second, 'workshop-pass-1234');
    assert.equal(prompt.open, true);
  } finally { prompt.close(); }
});

test('both prompts are shown, and neither password is echoed', async () => {
  const { input, output, text } = streams();
  // terminal: true is the path a real TTY takes, where readline rather than
  // the driver does the echoing.
  const prompt = createPasswordPrompt({ input, output, terminal: true });
  try {
    const first = prompt.ask('Admin password (not echoed): ');
    input.write('workshop-pass-1234\n');
    await first;
    const second = prompt.ask('Repeat password: ');
    input.write('a-different-password\n');
    await second;

    assert.match(text(), /Admin password \(not echoed\): /);
    assert.match(text(), /Repeat password: /);
    assert.ok(!text().includes('workshop-pass-1234'), 'the first password must never be printed');
    assert.ok(!text().includes('a-different-password'), 'nor the second');
  } finally { prompt.close(); }
});

test('a closed input fails instead of hanging on a callback that never comes', async () => {
  const { input, output } = streams();
  const prompt = createPasswordPrompt({ input, output, terminal: false });
  try {
    const pending = prompt.ask('Admin password (not echoed): ');
    input.end();
    await assert.rejects(pending, /No password was given/);
    // And a later ask on the closed interface fails the same way, rather than
    // resolving with something empty.
    await assert.rejects(prompt.ask('Repeat password: '), /No password was given/);
    assert.equal(prompt.open, false);
  } finally { prompt.close(); }
});
