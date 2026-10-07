import nodemailer from 'nodemailer'

export interface MailOptions {
  from: string
  to: string
  appPassword: string
  subject: string
  text: string
}

export type Mailer = (o: MailOptions) => Promise<void>

/** Gmail SMTP with an app password. */
export const sendGmail: Mailer = async (o) => {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: o.from, pass: o.appPassword.replace(/\s+/g, '') },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
  try {
    await transport.sendMail({ from: o.from, to: o.to, subject: o.subject, text: o.text })
  } finally {
    transport.close()
  }
}

/** Plain words for the usual Gmail failures. */
export function explainMailError(err: unknown): string {
  const text = String(
    (err as { message?: string; response?: string })?.response ?? (err as Error)?.message ?? err,
  )
  if (/535|invalid login|username and password not accepted|application-specific/i.test(text)) {
    return 'Gmail did not accept the sign-in. Use a 16 character app password, not your normal password. Google Account, Security, 2-Step Verification must be on.'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(text))
    return 'Could not reach Gmail. Check the internet connection.'
  return text.replace(/\s+/g, ' ').slice(0, 200)
}
