import { describe, expect, it } from 'vitest';
import { loginCodeEmail } from './templates/login-code';

describe('loginCodeEmail', () => {
  it('includes the code in the subject and body', () => {
    const { subject, html, text } = loginCodeEmail({ code: '123456' });

    expect(subject).toContain('123456');
    expect(html).toContain('123456');
    expect(text).toContain('123456');
  });
});
