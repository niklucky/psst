/**
 * Shared interactive prompt utilities for the CLI.
 *
 * Handles TTY vs non-TTY (CI/piped) gracefully:
 * - On a TTY: password input is masked (no echo)
 * - In CI/piped: falls back to a plain readline read (visible — caller
 *   should use SILO_MASTER_KEY env var instead of interactive prompts)
 */

import * as rl from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Prompt for plain-text input (visible as the user types).
 */
export async function promptInput(question: string): Promise<string> {
  const iface = rl.createInterface({ input, output });
  const answer = await iface.question(question);
  iface.close();
  return answer.trim();
}

/**
 * Prompt for a password — hides typed characters on TTY.
 * Falls back to plain readline on non-TTY environments (CI).
 */
export function promptPassword(question: string): Promise<string> {
  // Non-TTY (CI, piped stdin) — fall back to visible readline
  if (!process.stdin.isTTY) {
    return promptInput(question);
  }

  return new Promise<string>((resolve, reject) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let value = '';

    const onData = (ch: string) => {
      switch (ch) {
        case '': // Ctrl-C
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          reject(new Error('Interrupted'));
          break;

        case '\r':
        case '\n': // Enter
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          break;

        case '': // Backspace
          if (value.length > 0) value = value.slice(0, -1);
          break;

        default:
          // Only accept printable characters
          if (ch >= ' ') value += ch;
      }
    };

    process.stdin.on('data', onData);
  });
}
