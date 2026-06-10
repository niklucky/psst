import { escapeHtml, renderButton, renderLayout, type EmailContent } from './layout';

export interface WelcomeEmailParams {
  verifyUrl: string;
}

export function welcomeEmail({ verifyUrl }: WelcomeEmailParams): EmailContent {
  const subject = 'Welcome to Psst — verify your email';

  const html = renderLayout(`
    <p style="margin:0 0 16px;">Welcome to Psst!</p>
    <p style="margin:0 0 24px;">Psst is an end-to-end encrypted secrets manager — your data is encrypted on your device before it ever reaches the server. Please confirm your email address to finish setting up your account.</p>
    ${renderButton('Verify email', verifyUrl)}
    <p style="margin:0;color:#6b7280;font-size:13px;">This link expires in 24 hours. If you didn't create a Psst account, you can safely ignore this email.</p>
  `);

  const text = `Welcome to Psst!

Psst is an end-to-end encrypted secrets manager — your data is encrypted on your device before it ever reaches the server. Please confirm your email address to finish setting up your account.

Verify your email: ${verifyUrl}

This link expires in 24 hours. If you didn't create a Psst account, you can safely ignore this email.`;

  return { subject, html, text };
}
