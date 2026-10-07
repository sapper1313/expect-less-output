// Every user-facing string lives here so tone can change in one place.
export const COPY = {
  appName: 'Expect Less Output',
  tagline: 'The algorithm has been fed.',
  publishButton: 'Fine.',
  draftButton: 'Save as draft',
  success: 'Task adequate.',
  failureHeadline: 'Could not post. Probably for the best.',
  emptyCalendar: 'Nothing scheduled. The algorithm is hungry.',
  emptyQueue: 'Nothing in the queue. Add a video from New Post or Bulk Upload.',
  emptyLog: 'No activity yet.',
  metaReauthHeadline: 'Meta needs you to sign in again.',
  metaExpiryHeadline: 'Meta sign-in runs out soon.',
  reauthHeadline: 'YouTube needs you to sign in again.',
  missedHeadline: 'Missed it. The Mac was asleep.',
  aiChecklist: 'Add AI label in app',
  textAssistPlaceholder: 'AI assist (coming soon)',
  dryRunBadge: 'dry run',
  scheduleTooltip: (platforms: string[], when: string) =>
    platforms.length
      ? `Schedule to ${platforms.join(', ')} at ${when}`
      : 'Pick at least one platform first',
  failureDetail: (platform: string, brand: string, title: string, reason: string) =>
    `${platform}, ${brand}, "${title}": ${reason}`,
  nav: {
    calendar: 'Calendar',
    queue: 'Queue',
    newPost: 'New Post',
    bulk: 'Bulk Upload',
    brands: 'Brands',
    connections: 'Connections',
    activity: 'Activity Log',
    settings: 'Settings',
    about: 'About',
  },
  confirm: {
    deletePost: 'Delete this post? The video file stays on disk unless you tick the box.',
    cancelPost: 'Cancel this post? It will not be published.',
    reschedule: (when: string) => `Move this post to ${when} Eastern?`,
    quitPending: (n: number) =>
      `${n} post${n === 1 ? ' is' : 's are'} still scheduled. If you quit, nothing will be posted until you open the app again. Quit anyway?`,
    archiveBrand: 'Archive this brand? Its posts stay, but it disappears from the pickers.',
  },
}
