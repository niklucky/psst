export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Matches the web app's primary indigo-600 accent. */
const BRAND_COLOR = '#4f46e5';

/**
 * Wraps templated body HTML in a minimal branded shell.
 * Inline styles only — most email clients strip <style> blocks.
 */
export function renderLayout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;border:1px solid #f3f4f6;overflow:hidden;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:20px;font-weight:700;color:#111827;">🔐 Psst</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#374151;font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Renders a centered call-to-action button. */
export function renderButton(label: string, url: string): string {
  return `<p style="margin:0 0 24px;text-align:center;">
  <a href="${url}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">${escapeHtml(label)}</a>
</p>`;
}

/** Renders a large monospace one-time code block (verification / login challenge codes). */
export function renderCode(code: string): string {
  return `<p style="margin:0 0 24px;text-align:center;">
  <span style="display:inline-block;background-color:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;padding:16px 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#111827;">${escapeHtml(code)}</span>
</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
