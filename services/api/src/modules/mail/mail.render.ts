/**
 * The Velnes mail layout — every mail the platform sends wears it.
 *
 * Built for mail clients, not browsers: tables, inline styles, web-safe
 * fallbacks. The palette is the consumer app's — coral on warm white,
 * ink brown for headings — so a mail from Velnes looks like Velnes.
 * Body text arrives as the prose the door wrote (plain text with blank
 * lines between paragraphs); it is escaped, then paragraphs, line
 * breaks and bare links are drawn. Structured extras ride in `meta`: a
 * one-time `code` is set large, a `cta` becomes the button.
 */

export interface MailMeta {
  cta?: { label: string; url: string } | undefined;
  code?: string | undefined;
}

export interface RenderInput {
  subject: string;
  body: string;
  meta?: MailMeta | undefined;
  /** The salon the mail speaks for, for the footer; null = the platform. */
  salon?: string | null | undefined;
}

const BRAND = '#FF8D67';
const BRAND_DEEP = '#E3673D';
const INK = '#4D2A1F';
const TEXT = '#0D0D0D';
const MUTED = '#727272';
const BG = '#FFF9F7';
const WARM = '#FFF1EC';
const LINE = '#F0EAE7';
const FONT = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Yeseva One', Georgia, 'Times New Roman', serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g;

/** Escaped prose → paragraphs with line breaks and live links. */
function prose(body: string): string {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((p) => {
      const safe = escapeHtml(p)
        .replace(URL_RE, (u) => `<a href="${u}" style="color:${BRAND_DEEP};text-decoration:underline;word-break:break-all">${u}</a>`)
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 14px;font:15px/1.6 ${FONT};color:${TEXT}">${safe}</p>`;
    })
    .join('');
}

function codeBlock(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td align="center" style="background:${WARM};border-radius:12px;padding:18px 12px;font:700 32px/1.2 ${FONT};letter-spacing:8px;color:${INK}">${escapeHtml(code)}</td></tr></table>`;
}

function button(cta: { label: string; url: string }): string {
  const url = escapeHtml(cta.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 10px"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px;background:${BRAND}"><a href="${url}" style="display:inline-block;padding:14px 26px;font:700 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(cta.label)}</a></td></tr></table><p style="margin:0 0 14px;font:12px/1.5 ${FONT};color:${MUTED}">Or open this link: <a href="${url}" style="color:${BRAND_DEEP};word-break:break-all">${url}</a></p>`;
}

export function renderMail(input: RenderInput): { html: string; text: string } {
  const preheader = escapeHtml(input.body.trim().split('\n')[0] ?? '').slice(0, 140);
  const salon = input.salon ? escapeHtml(input.salon) : null;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="padding:0 8px 18px;font:400 30px/1 ${DISPLAY};color:${BRAND}">Velnes</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;padding:32px 32px 22px">
<h1 style="margin:0 0 18px;font:400 22px/1.3 ${DISPLAY};color:${INK}">${escapeHtml(input.subject)}</h1>
${prose(input.body)}
${input.meta?.code ? codeBlock(input.meta.code) : ''}
${input.meta?.cta ? button(input.meta.cta) : ''}
</td></tr>
<tr><td style="padding:18px 8px 0;font:12px/1.6 ${FONT};color:${MUTED}">${salon ? `Sent by Velnes for ${salon}.` : 'Sent by Velnes.'} Beauty, wellness and health, booked in one place.</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = [
    input.body.trim(),
    input.meta?.code ? `\n${input.meta.code}` : '',
    input.meta?.cta ? `\n${input.meta.cta.label}: ${input.meta.cta.url}` : '',
    `\n— ${salon ? `Sent by Velnes for ${input.salon}` : 'Velnes'}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { html, text };
}
