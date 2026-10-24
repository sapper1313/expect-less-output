// Every user-facing string lives here so tone can change in one place.
export const COPY = {
  appName: 'Expect Less Output',
  tagline: 'The algorithm has been fed.',
  publishButton: 'Save',
  draftButton: 'Save as draft',
  success: 'Task adequate.',
  failureHeadline: 'Could not post. Probably for the best.',
  emptyCalendar: 'Nothing scheduled. The algorithm is hungry.',
  emptyQueue: 'Nothing in the queue. Add a video from New Post or Bulk Upload.',
  emptyLog: 'No activity yet.',
  metaReauthHeadline: 'Meta needs you to sign in again.',
  metaExpiryHeadline: 'Meta sign-in runs out soon.',
  tiktokReauthHeadline: 'TikTok needs you to sign in again.',
  tiktokFullHeadline: 'TikTok is full for today.',
  reauthHeadline: 'YouTube needs you to sign in again.',
  missedHeadline: 'Missed it. The Mac was asleep.',
  aiChecklist: 'Add AI label in app',
  textAssistPlaceholder: 'AI assist (coming soon)',
  dryRunBadge: 'not connected yet',
  scheduleTooltip: (platforms: string[], when: string) =>
    platforms.length
      ? `Schedule to ${platforms.join(', ')} at ${when}`
      : 'Pick at least one platform first',
  failureDetail: (platform: string, brand: string, title: string, reason: string) =>
    `${platform}, ${brand}, "${title}": ${reason}`,
  nav: {
    home: 'Home',
    channels: 'Channels',
    calendar: 'Calendar',
    queue: 'Queue',
    inbox: 'Inbox',
    upcoming: 'Upcoming',
    stats: 'Analytics',
    studio: 'Studio',
    schedule: 'Schedule',
    newPost: 'New Post',
    bulk: 'Bulk Upload',
    brands: 'Channel setup',
    connections: 'Connections',
    activity: 'Activity Log',
    settings: 'Settings',
    about: 'About',
    tiktokDemo: 'TikTok demo',
  },
  stats: {
    notAvailable: 'Not available',
    pending: 'Not read yet. Numbers appear after the first refresh.',
    approximate: 'A ~ means the platform only gives a rough number.',
    chartNeedsMore: 'The chart appears after two readings.',
    refreshed: 'Stats refreshed',
    imported: 'Existing videos imported',
    relativeNote:
      'Numbers are shown as "times your typical video" so brands and platforms can be compared.',
    rawNote: 'Numbers are raw views.',
    notEnough:
      'Not enough videos yet. It needs at least 10 videos that are a week old or more. Click Import existing videos to add the ones already on your channels.',
    noTop: 'No hour has two or more videos yet.',
    slotNote:
      'Suggested from how your own videos did (Eastern time). Click Add to put a time in the list, then Save slots.',
    slotNotEnough:
      'Suggestions appear once the app has numbers for at least 10 videos that are a week old or more. Use Import existing videos on the Analytics screen.',
    importProblems: 'Imported with problems',
    importedNote:
      'Videos that were on your channels before this app. They are read once and then every day for 90 days after they were published.',
    empty:
      'No posts were published in this time range yet. Click Import existing videos to add the ones already on your channels.',
    summaryNote:
      'Totals use the latest numbers for videos published in the range. Platforms that give no numbers say why.',
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
