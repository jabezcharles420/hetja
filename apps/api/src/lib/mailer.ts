/**
 * Email delivery for OTP codes, via Brevo's SMTP relay (free tier, 300/day —
 * see the plan doc for why Brevo over a paid provider or Supabase Auth's
 * built-in email).
 *
 * This is the piece that never existed for phone OTP: `apps/api/src/lib/otp.ts`
 * generated a code and `auth.ts` only ever returned it in the HTTP response
 * when NODE_ENV !== "production" — in production a code was minted and sent
 * to nobody. There was no SMS/email plumbing anywhere in the repo. This
 * module is that plumbing, and `loadConfig` (config.ts) refuses to boot in
 * production without the SMTP env vars this depends on, so the same failure
 * mode (mint a code, deliver it to nobody, and have no one notice) cannot
 * recur silently.
 *
 * From address: send FROM no-reply@hetja.in, which has SPF/DKIM/DMARC set up
 * on the domain via Cloudflare DNS. A from-address on a domain without that
 * (e.g. a personal Gmail address) gets silently dropped by Brevo/receiving
 * providers rather than bouncing — confirmed by hand while wiring this up.
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface MailerConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

let cachedTransporter: Transporter | undefined;
let cachedKey: string | undefined;

function getTransporter(cfg: MailerConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (!cachedTransporter || cachedKey !== key) {
    cachedTransporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      // Port 587 is STARTTLS, not implicit TLS: the connection starts in
      // plaintext and upgrades. `secure: false` picks that mode; `secure:
      // true` would instead attempt implicit TLS on connect (port 465) and
      // fail against Brevo's 587 relay. requireTLS refuses to send if the
      // STARTTLS upgrade doesn't happen, rather than silently falling back
      // to plaintext.
      secure: false,
      requireTLS: true,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    cachedKey = key;
  }
  return cachedTransporter;
}

export async function sendOtpEmail(to: string, code: string, cfg: MailerConfig): Promise<void> {
  const transporter = getTransporter(cfg);
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject: `${code} is your Hetja sign-in code`,
    text: `Your Hetja sign-in code is ${code}. It expires in 5 minutes.\n\nIf you did not request this, you can ignore this email.`,
  });
}
