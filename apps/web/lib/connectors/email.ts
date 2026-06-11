import nodemailer from "nodemailer";

/**
 * Email sending over plain SMTP — works with Gmail (app password),
 * Google Workspace, Outlook, or any mailbox you own. Free, no extra
 * service. Credentials live in a `connections` row (provider 'email'),
 * AES-encrypted like everything else.
 *
 * This is an ACTION connector: it is only ever invoked from the
 * approval executor, after the owner has tapped Approve.
 */

export type EmailCreds = {
  host: string;        // e.g. smtp.gmail.com
  port?: string | number; // 587 (STARTTLS) or 465 (TLS); default 587
  username: string;
  password: string;    // for Gmail: an app password
  from?: string;       // defaults to username
};

function transporter(creds: EmailCreds) {
  const port = Number(creds.port || 587);
  return nodemailer.createTransport({
    host: creds.host,
    port,
    secure: port === 465,
    auth: { user: creds.username, pass: creds.password },
  });
}

/** Live credential check used by the Connections "Test" button. */
export async function verifyEmail(creds: EmailCreds): Promise<void> {
  if (!creds?.host || !creds?.username || !creds?.password) {
    throw new Error("host, username and password are required");
  }
  await transporter(creds).verify();
}

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;       // plain text; doubles as the HTML fallback
  cc?: string;
  bcc?: string;
};

export async function sendEmail(
  creds: EmailCreds,
  msg: EmailMessage
): Promise<{ messageId: string; accepted: string[] }> {
  if (!msg.to || !msg.subject) throw new Error("email needs `to` and `subject`");
  const info = await transporter(creds).sendMail({
    from: creds.from || creds.username,
    to: msg.to,
    cc: msg.cc || undefined,
    bcc: msg.bcc || undefined,
    subject: msg.subject,
    text: msg.body || "",
  });
  return { messageId: info.messageId, accepted: (info.accepted || []).map(String) };
}
