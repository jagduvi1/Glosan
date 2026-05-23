const { Resend } = require('resend');

const DEFAULT_FROM = 'Glosan <info@glosan.app>';

let client = null;

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

function isEnabled() {
  return Boolean(process.env.RESEND_API_KEY);
}

function from() {
  return process.env.EMAIL_FROM || DEFAULT_FROM;
}

// Skickar ett email via Resend. Returnerar { id } vid success, kastar vid
// fel. Loggar fel men exponerar inte resend-specifika detaljer mot API-
// klienten (anropande route ska översätta till generisk 502).
async function send({ to, subject, html, text, replyTo }) {
  const c = getClient();
  if (!c) throw new Error('Email service not configured (RESEND_API_KEY missing)');
  if (!to || !subject || (!html && !text)) {
    throw new Error('send: to, subject and html|text are required');
  }
  const payload = { from: from(), to, subject };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.replyTo = replyTo;
  const { data, error } = await c.emails.send(payload);
  if (error) {
    const msg = error.message || error.name || 'unknown error';
    throw new Error(`Resend error: ${msg}`);
  }
  return data;
}

// Wrappar HTML-text i en enkel hand-skissad template som matchar Glosans
// look — paper-bakgrund, ink-text, coral accent. Inline CSS för bästa
// email-klient-stöd.
function wrapTemplate({ title, intro, ctaUrl, ctaLabel, footer }) {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeCta = escapeHtml(ctaLabel);
  const safeFooter = escapeHtml(footer || 'Du får det här mailet eftersom någon har skapat ett konto på glosan.app med din email. Var det inte du? Ignorera det här mailet.');
  return `<!DOCTYPE html>
<html lang="sv">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#F4EAD0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1F1B16;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4EAD0;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FBF5E6;border:3px solid #1F1B16;border-radius:20px;">
          <tr><td style="padding:32px 28px;">
            <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#1F1B16;">${safeTitle}</h1>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#1F1B16;">${safeIntro}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
              <tr><td style="background:#FF6B6B;border:3px solid #1F1B16;border-radius:14px;box-shadow:4px 4px 0 0 #1F1B16;">
                <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;color:#FBF5E6;text-decoration:none;font-weight:800;font-size:17px;">${safeCta}</a>
              </td></tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5A5147;">Eller kopiera den här länken: <br><a href="${ctaUrl}" style="color:#E54B4B;word-break:break-all;">${ctaUrl}</a></p>
            <hr style="border:none;border-top:1px dashed #E8DCB8;margin:28px 0;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#5A5147;">${safeFooter}</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#5A5147;">Glosan · <a href="https://glosan.app" style="color:#5A5147;">glosan.app</a></p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { isEnabled, send, wrapTemplate, from };
