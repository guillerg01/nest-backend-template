# Notifications Module

Email providers, push notifications, SMS, in-app notifications, templates, and queue patterns.

---

## Table of Contents

1. [Nodemailer (current)](#nodemailer-smtp)
2. [Resend](#resend)
3. [SendGrid](#sendgrid)
4. [Mailgun](#mailgun)
5. [EmailJS — Why NOT to Use Server-Side](#emailjs-warning)
6. [Template Engines](#template-engines)
7. [Push Notifications (Web + Mobile)](#push-notifications)
8. [SMS with Twilio](#sms-with-twilio)
9. [In-App Notifications](#in-app-notifications)
10. [Queue Pattern (BullMQ)](#queue-pattern)

---

## Nodemailer (SMTP)

**Best for:** self-hosted mail servers, Gmail/G Suite, any SMTP server, development.

```typescript
// notifications.service.ts
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private transporter: nodemailer.Transporter;

  onModuleInit() {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: this.configService.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({
      from: `"My App" <${this.configService.get('SMTP_FROM')}>`,
      to,
      subject,
      html,
    });
  }
}
```

**Gmail config:**

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourapp@gmail.com
SMTP_PASS=<app-specific-password>  # NOT your Gmail password — generate at myaccount.google.com/apppasswords
```

**Production note:** Gmail has rate limits (500/day). For production volume, use a dedicated provider.

---

## Resend

**Best for:** modern apps, React Email templates, excellent developer experience, generous free tier (3,000/month).

```bash
npm install resend
```

```typescript
// resend.service.ts
import { Resend } from 'resend';

@Injectable()
export class ResendService {
  private resend: Resend;

  constructor(private configService: ConfigService) {
    this.resend = new Resend(this.configService.get('RESEND_API_KEY'));
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    from = 'MyApp <noreply@myapp.com>',
  ): Promise<void> {
    const { error } = await this.resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
  }

  async sendWithReactEmail(
    to: string,
    subject: string,
    reactComponent: React.ReactElement, // from @react-email/render
  ): Promise<void> {
    const { render } = await import('@react-email/render');
    const html = render(reactComponent);

    await this.sendEmail(to, subject, html);
  }
}
```

```typescript
// Example: send a welcome email with React Email template
import { WelcomeEmail } from '../templates/welcome.email';

await this.resendService.sendWithReactEmail(
  user.email,
  'Welcome to MyApp!',
  WelcomeEmail({ username: user.firstName }),
);
```

**Docs:** [resend.com/docs](https://resend.com/docs)

---

## SendGrid

**Best for:** enterprise, high volume, advanced analytics, deliverability reputation.

```bash
npm install @sendgrid/mail
```

```typescript
// sendgrid.service.ts
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class SendGridService implements OnModuleInit {
  onModuleInit() {
    sgMail.setApiKey(this.configService.get('SENDGRID_API_KEY'));
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    await sgMail.send({
      to,
      from: {
        email: this.configService.get('SENDGRID_FROM_EMAIL'),
        name: this.configService.get('SENDGRID_FROM_NAME'),
      },
      subject,
      html,
      text: text ?? this.htmlToText(html),
    });
  }

  // Use SendGrid Dynamic Templates (built in their dashboard)
  async sendTemplate(
    to: string,
    templateId: string,
    dynamicData: Record<string, unknown>,
  ): Promise<void> {
    await sgMail.send({
      to,
      from: this.configService.get('SENDGRID_FROM_EMAIL'),
      templateId,
      dynamicTemplateData: dynamicData,
    });
  }

  private htmlToText(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}
```

**Docs:** [docs.sendgrid.com](https://docs.sendgrid.com)

---

## Mailgun

**Best for:** transactional email, good API, strong deliverability, pay-as-you-go pricing.

```bash
npm install mailgun.js form-data
```

```typescript
// mailgun.service.ts
import Mailgun from 'mailgun.js';
import FormData from 'form-data';

@Injectable()
export class MailgunService implements OnModuleInit {
  private client: ReturnType<Mailgun['client']>;
  private domain: string;

  onModuleInit() {
    const mailgun = new Mailgun(FormData);
    this.client = mailgun.client({
      username: 'api',
      key: this.configService.get('MAILGUN_API_KEY'),
      url: 'https://api.eu.mailgun.net', // use this if your domain is in EU region
    });
    this.domain = this.configService.get('MAILGUN_DOMAIN');
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    await this.client.messages.create(this.domain, {
      from: `MyApp <noreply@${this.domain}>`,
      to: [to],
      subject,
      html,
    });
  }

  async sendBatch(
    recipients: Array<{ email: string; variables: Record<string, string> }>,
    subject: string,
    html: string,
  ): Promise<void> {
    // Mailgun batch sending with recipient variables
    const toList = recipients.map(r => r.email);
    const recipientVariables = recipients.reduce((acc, r) => {
      acc[r.email] = r.variables;
      return acc;
    }, {} as Record<string, Record<string, string>>);

    await this.client.messages.create(this.domain, {
      from: `MyApp <noreply@${this.domain}>`,
      to: toList,
      subject,
      html,
      'recipient-variables': JSON.stringify(recipientVariables),
    });
  }
}
```

**Docs:** [documentation.mailgun.com](https://documentation.mailgun.com)

---

## EmailJS Warning

**Do NOT use `@emailjs/nodejs` on the server side.**

EmailJS was designed as a **client-side** library — it's meant to be called from the browser without exposing backend credentials. Using it server-side means:

1. Your service IDs and template IDs are exposed in server code (minor issue)
2. Requests are routed through EmailJS servers, adding latency
3. Rate limits are based on free-tier browser usage, not server-side bulk sending
4. No webhook support, no delivery tracking, no bounce handling
5. EmailJS bills per email on their paid plans — no bulk pricing
6. Cannot customize email headers, DKIM is on EmailJS's domain (bad for deliverability)

**Use Nodemailer, Resend, or SendGrid instead.** All have better server-side DX and capabilities.

---

## Template Engines

### Inline HTML (current)

```typescript
// Simple function returning HTML string
function welcomeEmailTemplate(name: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; padding: 40px;">
        <h1>Welcome, ${name}!</h1>
        <p>Thanks for signing up. Click below to verify your email.</p>
        <a href="{{verifyUrl}}" style="background:#4f46e5;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
          Verify Email
        </a>
      </body>
    </html>
  `;
}
```

**Pros:** zero dependencies, fast. **Cons:** hard to maintain complex designs.

### React Email

Production-quality, responsive email templates in React. Best DX.

```bash
npm install @react-email/components @react-email/render
```

```tsx
// templates/welcome.email.tsx
import { Html, Button, Text, Section, Container } from '@react-email/components';

interface WelcomeEmailProps {
  username: string;
  verifyUrl: string;
}

export function WelcomeEmail({ username, verifyUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Container style={{ maxWidth: '600px', margin: '0 auto' }}>
        <Section>
          <Text style={{ fontSize: '24px', fontWeight: 'bold' }}>
            Welcome, {username}!
          </Text>
          <Text>Thanks for signing up. Please verify your email.</Text>
          <Button
            href={verifyUrl}
            style={{ background: '#4f46e5', color: 'white', padding: '12px 24px' }}
          >
            Verify Email
          </Button>
        </Section>
      </Container>
    </Html>
  );
}
```

```typescript
// Usage
import { render } from '@react-email/render';
import { WelcomeEmail } from './templates/welcome.email';

const html = render(WelcomeEmail({ username: 'John', verifyUrl: 'https://...' }));
await this.notificationsService.sendEmail(user.email, 'Verify your email', html);
```

**Docs:** [react.email](https://react.email)

### Handlebars

Good for teams who prefer templating syntax, non-JS designers.

```bash
npm install handlebars
```

```typescript
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TemplateService {
  private templates = new Map<string, HandlebarsTemplateDelegate>();

  getTemplate(name: string): HandlebarsTemplateDelegate {
    if (!this.templates.has(name)) {
      const filePath = path.join(process.cwd(), 'templates', `${name}.hbs`);
      const source = fs.readFileSync(filePath, 'utf-8');
      this.templates.set(name, Handlebars.compile(source));
    }
    return this.templates.get(name);
  }

  render(name: string, context: Record<string, unknown>): string {
    return this.getTemplate(name)(context);
  }
}
```

### MJML

Write responsive email HTML without fighting CSS email clients.

```bash
npm install mjml
```

```typescript
import * as mjml2html from 'mjml';

function renderMjml(mjmlSource: string): string {
  const { html, errors } = mjml2html(mjmlSource);
  if (errors.length) throw new Error(`MJML: ${errors[0].formattedMessage}`);
  return html;
}
```

---

## Push Notifications

### Web Push (PWA)

```bash
npm install web-push
```

```typescript
// web-push.service.ts
import * as webpush from 'web-push';

@Injectable()
export class WebPushService implements OnModuleInit {
  onModuleInit() {
    webpush.setVapidDetails(
      `mailto:${this.configService.get('VAPID_EMAIL')}`,
      this.configService.get('VAPID_PUBLIC_KEY'),
      this.configService.get('VAPID_PRIVATE_KEY'),
    );
  }

  async sendPush(
    subscription: PushSubscription,
    payload: { title: string; body: string; url?: string },
  ): Promise<void> {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  }
}
```

Generate VAPID keys: `npx web-push generate-vapid-keys`

Store push subscriptions in DB per user. Frontend subscribes with `serviceWorker.pushManager.subscribe()`.

---

## SMS with Twilio

```bash
npm install twilio
```

```typescript
// sms.service.ts
import { Twilio } from 'twilio';

@Injectable()
export class SmsService {
  private client: Twilio;

  constructor(private configService: ConfigService) {
    this.client = new Twilio(
      this.configService.get('TWILIO_ACCOUNT_SID'),
      this.configService.get('TWILIO_AUTH_TOKEN'),
    );
  }

  async sendSms(to: string, body: string): Promise<void> {
    await this.client.messages.create({
      from: this.configService.get('TWILIO_PHONE_NUMBER'), // +15551234567
      to,
      body,
    });
  }

  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    await this.sendSms(phoneNumber, `Your verification code is: ${otp}. Valid for 5 minutes.`);
  }

  // Twilio Verify Service (managed OTP, recommended over DIY)
  async sendVerification(phoneNumber: string): Promise<void> {
    await this.client.verify.v2
      .services(this.configService.get('TWILIO_VERIFY_SERVICE_SID'))
      .verifications.create({ to: phoneNumber, channel: 'sms' });
  }

  async verifyOtp(phoneNumber: string, code: string): Promise<boolean> {
    const check = await this.client.verify.v2
      .services(this.configService.get('TWILIO_VERIFY_SERVICE_SID'))
      .verificationChecks.create({ to: phoneNumber, code });

    return check.status === 'approved';
  }
}
```

**Docs:** [twilio.com/docs/sms](https://www.twilio.com/docs/sms)

---

## In-App Notifications

Store in DB, deliver via WebSocket when user is online.

### Entity

```typescript
@Entity('notifications')
export class AppNotification extends BaseEntity {
  @Column()
  userId: string;

  @Column()
  title: string;

  @Column('text', { nullable: true })
  body: string;

  @Column({ default: false })
  read: boolean;

  @Column({ nullable: true })
  readAt: Date;

  @Column({ default: 'info' }) // 'info' | 'success' | 'warning' | 'error'
  type: string;

  @Column({ nullable: true })
  actionUrl: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown>;
}
```

### Service

```typescript
async createAndDeliver(
  userId: string,
  notification: CreateNotificationDto,
): Promise<void> {
  // 1. Persist in DB
  const saved = await this.notificationsRepo.create({ ...notification, userId });

  // 2. Deliver via WebSocket if user is online
  this.realtimeGateway.server
    .to(`user_${userId}`)
    .emit('notification', saved);

  // 3. If offline, it's already in DB — user will fetch on next login
}

// REST endpoint to fetch unread notifications
async getUnread(userId: string): Promise<AppNotification[]> {
  return this.notificationsRepo.find({
    where: { userId, read: false },
    order: { createdAt: 'DESC' },
    take: 50,
  });
}
```

---

## Queue Pattern

**Never** send emails or push notifications synchronously in the request handler. Use queues.

```typescript
// Slow: blocks response thread for 500–2000ms
@Post('register')
async register(@Body() dto: RegisterDto) {
  const user = await this.usersService.create(dto);
  await this.notificationsService.sendWelcomeEmail(user); // BLOCKING — bad
  return user;
}

// Fast: returns immediately, email sent in background
@Post('register')
async register(@Body() dto: RegisterDto) {
  const user = await this.usersService.create(dto);
  await this.emailQueue.add('welcome', { userId: user.id }); // non-blocking
  return user;
}
```

See [queue/README.md](../queue/README.md) for full BullMQ setup.
