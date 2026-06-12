import { describe, expect, it } from 'vitest';
import { inviteEmail } from './templates/invite';

describe('inviteEmail', () => {
  const params = {
    orgName: 'Acme Inc',
    inviterEmail: 'alice@example.com',
    inviteUrl: 'https://app.silo.dev/invite/abc123',
    role: 'member',
  };

  it('includes the inviter, org name, role and link in the subject and body', () => {
    const { subject, html, text } = inviteEmail(params);

    expect(subject).toBe('alice@example.com invited you to join Acme Inc on Silo');
    expect(html).toContain('Acme Inc');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('member');
    expect(html).toContain(params.inviteUrl);
    expect(text).toContain(params.inviteUrl);
    expect(text).toContain('Acme Inc');
  });

  it('escapes HTML in user-controlled fields', () => {
    const { html } = inviteEmail({
      ...params,
      orgName: '<script>alert(1)</script>',
      inviterEmail: '"><img src=x>@example.com',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
  });
});
