import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type Sender = (message: EmailMessage) => Promise<void>;

function createSender(): Sender {
  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['EMAIL_FROM'];

  if (!apiKey || !from) {
    return async (message) => {
      console.log(`[dev] Email to ${message.to}: ${message.subject}\n\n${message.text}`);
    };
  }

  const resend = new Resend(apiKey);

  return async (message) => {
    const { error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      throw new Error(`Failed to send email to ${message.to}: ${error.message}`);
    }
  };
}

/**
 * Sends a transactional email via Resend.
 *
 * Falls back to logging to the console when RESEND_API_KEY/EMAIL_FROM are unset
 * (local dev, tests) — mirrors the existing `[dev] Invite token for ...` pattern
 * in the organisations router. This is the single choke point every email-sending
 * call goes through, so tests only need to mock `@psst/email` once.
 */
export const sendEmail: Sender = createSender();
