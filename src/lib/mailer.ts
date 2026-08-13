/**
 * Outbound email. One job today: password-reset links.
 *
 * Configured entirely through SMTP_* + APP_BASE_URL in .env (see config.ts) so
 * the provider is swappable without a code change — production uses Brevo's
 * free SMTP relay. While unconfigured, config.mailEnabled is false, the login
 * screen shows the "contact your administrator" hint instead of the email
 * form, and POST /api/auth/forgot answers 400.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.ts';
import { t, tf } from './messages.ts';

let transporter: Transporter | null = null;

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // Port 465 is implicit TLS; 587 (Brevo's default) upgrades via STARTTLS.
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  return transporter;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendPasswordResetEmail(opts: {
  to: string;
  displayName: string;
  username: string;
  link: string;
}): Promise<void> {
  const intro = tf('mail.resetIntro', { name: opts.displayName, username: opts.username });
  const action = t('mail.resetAction');
  const ignore = t('mail.resetIgnore');
  const dir = config.UI_LANG === 'he' ? 'rtl' : 'ltr';

  await transport().sendMail({
    from: config.SMTP_FROM,
    to: opts.to,
    subject: t('mail.resetSubject'),
    text: `${intro}\n\n${action}\n${opts.link}\n\n${ignore}\n`,
    html:
      `<div dir="${dir}" style="font-family:Arial,sans-serif;line-height:1.6;font-size:15px">` +
      `<p>${escapeHtml(intro)}</p>` +
      `<p>${escapeHtml(action)}</p>` +
      // The link is machine-generated (base64url token on our own origin) and
      // shown verbatim so the recipient can see where it leads before clicking.
      `<p><a href="${opts.link}" dir="ltr">${opts.link}</a></p>` +
      `<p style="color:#666">${escapeHtml(ignore)}</p>` +
      `</div>`,
  });
}
