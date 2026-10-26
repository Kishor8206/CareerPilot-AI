import { env } from '../config/env';
import { moduleLogger } from '../config/logger';

const log = moduleLogger('email');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Email abstraction (§25, §28).
 *
 * The console transport is the development default: it logs the message instead
 * of sending it, so password-reset and verification flows are fully exercisable
 * without SMTP credentials. Wire up `SmtpTransport` for production.
 */
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ delivered: boolean; detail: string }>;
}

class ConsoleTransport implements EmailTransport {
  readonly name = 'console';
  async send(message: EmailMessage) {
    log.info(
      { to: message.to, subject: message.subject, preview: message.text.slice(0, 500) },
      'Email (console transport - not actually sent)',
    );
    return { delivered: true, detail: 'Logged to the application log by the console transport.' };
  }
}

class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  async send(message: EmailMessage) {
    // nodemailer is an optional dependency; installing it enables real delivery.
    try {
      const nodemailer = (await import('nodemailer' as string)) as {
        createTransport: (opts: unknown) => { sendMail: (m: unknown) => Promise<{ messageId: string }> };
      };
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
      const info = await transporter.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { delivered: true, detail: info.messageId };
    } catch (error) {
      log.error({ err: error, to: message.to }, 'SMTP delivery failed');
      return { delivered: false, detail: (error as Error).message };
    }
  }
}

export const emailTransport: EmailTransport =
  env.MAIL_PROVIDER === 'smtp' ? new SmtpTransport() : new ConsoleTransport();

export async function sendEmail(message: EmailMessage) {
  return emailTransport.send(message);
}

/* ---- Templates ---- */

export function passwordResetEmail(name: string, token: string, resetUrl: string): EmailMessage {
  const link = `${resetUrl}?token=${encodeURIComponent(token)}`;
  return {
    to: '',
    subject: `${env.APP_NAME} - Reset your password`,
    text: `Hello ${name},\n\nA password reset was requested for your ${env.APP_NAME} account.\nOpen this link within 30 minutes to choose a new password:\n\n${link}\n\nIf you did not request this, no action is needed - your password stays unchanged.`,
  };
}

export function emailVerificationEmail(name: string, token: string, verifyUrl: string): EmailMessage {
  const link = `${verifyUrl}?token=${encodeURIComponent(token)}`;
  return {
    to: '',
    subject: `${env.APP_NAME} - Verify your email address`,
    text: `Hello ${name},\n\nWelcome to ${env.APP_NAME}. Please confirm your email address by opening this link:\n\n${link}\n\nThe link expires in 24 hours.`,
  };
}
