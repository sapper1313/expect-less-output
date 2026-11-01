/** When older videos go to another platform. */
export type SendSchedule =
  | { mode: 'now'; spacingSeconds: number }
  | { mode: 'start'; startAtUtc: string; everyMinutes: number }
  | { mode: 'channel' }
