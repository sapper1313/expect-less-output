// Sends one test iMessage the same way the app does. Usage: node scripts/send-test-imessage.mjs +18045551234 "text"
import { sendIMessage } from '../src/main/alerts/imessage.ts'

const [, , number, ...rest] = process.argv
const text = rest.join(' ') || 'Expect Less Output test message. Nothing is wrong.'
const r = await sendIMessage(number, text)
console.log(r.ok ? 'SENT' : 'NOT SENT', '-', r.message)
process.exit(r.ok ? 0 : 1)
