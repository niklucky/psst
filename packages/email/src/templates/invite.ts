import { escapeHtml, renderButton, renderLayout, type EmailContent } from './layout';

export interface InviteEmailParams {
  orgName: string;
  inviterEmail: string;
  inviteUrl: string;
  /** owner | admin | member */
  role: string;
}

export function inviteEmail({ orgName, inviterEmail, inviteUrl, role }: InviteEmailParams): EmailContent {
  const subject = `${inviterEmail} invited you to join ${orgName} on Silo`;

  const html = renderLayout(`
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;"><strong>${escapeHtml(inviterEmail)}</strong> invited you to join <strong>${escapeHtml(orgName)}</strong> on Silo as a <strong>${escapeHtml(role)}</strong>.</p>
    <p style="margin:0 0 24px;">Silo is an end-to-end encrypted secrets manager — your data is encrypted on your device before it ever reaches the server.</p>
    ${renderButton('Accept invitation', inviteUrl)}
    <p style="margin:0;color:#6b7280;font-size:13px;">This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.</p>
  `);

  const text = `${inviterEmail} invited you to join ${orgName} on Silo as a ${role}.

Accept your invitation: ${inviteUrl}

This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.`;

  return { subject, html, text };
}
