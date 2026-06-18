import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; path: string }[];
}

export interface WelcomeEmailParams {
  name: string;
  email: string;
  verificationLink?: string;
}

export interface ResetPasswordEmailParams {
  name: string;
  email: string;
  resetLink: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT', 587),
      secure: config.get<number>('SMTP_PORT') === 465,
      auth: {
        user: config.get('SMTP_USER'),
        pass: config.get('SMTP_PASS'),
      },
    });
  }

  async send(options: EmailOptions): Promise<void> {
    const from = this.config.get('EMAIL_FROM', 'noreply@example.com');

    try {
      await this.transporter.sendMail({
        from,
        to: Array.isArray(options.to) ? options.to.join(',') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
      });
      this.logger.log(`Email sent to: ${options.to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}: ${error.message}`);
      throw error;
    }
  }

  async sendWelcome(params: WelcomeEmailParams): Promise<void> {
    await this.send({
      to: params.email,
      subject: 'Welcome! Please verify your email',
      html: this.welcomeTemplate(params),
    });
  }

  async sendResetPassword(params: ResetPasswordEmailParams): Promise<void> {
    await this.send({
      to: params.email,
      subject: 'Reset your password',
      html: this.resetPasswordTemplate(params),
    });
  }

  async sendNotification(to: string, title: string, body: string): Promise<void> {
    await this.send({
      to,
      subject: title,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>${title}</h2>
        <p>${body}</p>
      </div>`,
    });
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Email Templates ──────────────────────────────────────────────────────

  private welcomeTemplate(params: WelcomeEmailParams): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2>Welcome, ${params.name}!</h2>
        <p>Your account has been created successfully.</p>
        ${params.verificationLink ? `
          <p>Please verify your email to get started:</p>
          <a href="${params.verificationLink}"
             style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:6px;text-decoration:none">
            Verify Email
          </a>
        ` : ''}
        <hr style="margin:24px 0">
        <p style="color:#666;font-size:12px">If you didn't create this account, ignore this email.</p>
      </div>
    `;
  }

  private resetPasswordTemplate(params: ResetPasswordEmailParams): string {
    return `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2>Password Reset Request</h2>
        <p>Hi ${params.name}, you requested to reset your password.</p>
        <p>Click the button below. This link expires in 2 hours.</p>
        <a href="${params.resetLink}"
           style="display:inline-block;background:#ef4444;color:white;padding:12px 24px;border-radius:6px;text-decoration:none">
          Reset Password
        </a>
        <hr style="margin:24px 0">
        <p style="color:#666;font-size:12px">If you didn't request this, ignore this email. Your password won't change.</p>
      </div>
    `;
  }
}
