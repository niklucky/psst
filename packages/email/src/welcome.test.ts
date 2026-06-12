import { describe, expect, it } from 'vitest';
import { welcomeEmail } from './templates/welcome';

describe('welcomeEmail', () => {
  it('includes the verify link in the subject and body', () => {
    const verifyUrl = 'https://app.silo.dev/verify-email/abc123';
    const { subject, html, text } = welcomeEmail({ verifyUrl });

    expect(subject).toContain('Silo');
    expect(html).toContain(verifyUrl);
    expect(text).toContain(verifyUrl);
  });
});
