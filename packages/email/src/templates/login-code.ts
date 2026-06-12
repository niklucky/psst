import { renderCode, renderLayout, type EmailContent } from './layout';

export interface LoginCodeEmailParams {
  code: string;
}

export function loginCodeEmail({ code }: LoginCodeEmailParams): EmailContent {
  const subject = `${code} is your Silo sign-in code`;

  const html = renderLayout(`
    <p style="margin:0 0 16px;">We noticed a sign-in to your Silo account from a new device or browser.</p>
    <p style="margin:0 0 16px;">Enter this code to finish signing in:</p>
    ${renderCode(code)}
    <p style="margin:0;color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you didn't try to sign in, you can safely ignore this email — your account is still secure.</p>
  `);

  const text = `We noticed a sign-in to your Silo account from a new device or browser.

Your sign-in code: ${code}

This code expires in 10 minutes. If you didn't try to sign in, you can safely ignore this email — your account is still secure.`;

  return { subject, html, text };
}
