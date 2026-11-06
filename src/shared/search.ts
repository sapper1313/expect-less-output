export type SearchKind = 'episode' | 'post' | 'idea' | 'comment' | 'bible' | 'log' | 'page'

export interface SearchTarget {
  screen:
    | 'home'
    | 'calendar'
    | 'queue'
    | 'studio'
    | 'channels'
    | 'newPost'
    | 'schedule'
    | 'stats'
    | 'settings'
    | 'activity'
    | 'financial'
    | 'aiSettings'
  studioTab?: string
  statsTab?: string
  channelsTab?: string
  settingsTab?: string
  episodeId?: string
  postId?: number
}

export interface SearchHit {
  kind: SearchKind
  title: string
  subtitle: string
  target: SearchTarget
}

/** Places in the app, found by what you would call them. */
export const PAGES: Array<{ title: string; words: string; target: SearchTarget }> = [
  {
    title: 'Home dashboard',
    words: 'home dashboard overview pipeline health',
    target: { screen: 'home' },
  },

  { title: 'Queue', words: 'queue waiting failed missed posts', target: { screen: 'queue' } },
  {
    title: 'Studio: Library',
    words: 'library episodes scripts videos',
    target: { screen: 'studio', studioTab: 'library' },
  },
  {
    title: 'Studio: Bible',
    words: 'bible voice premise series tone',
    target: { screen: 'studio', studioTab: 'bible' },
  },
  {
    title: 'Studio: Flagged',
    words: 'flagged retry problems errors',
    target: { screen: 'studio', studioTab: 'flagged' },
  },
  {
    title: 'Financial: Spend and caps',
    words: 'spend caps cap money cost budget financial generate',
    target: { screen: 'financial' },
  },
  {
    title: 'Studio: Comments',
    words: 'comments replies',
    target: { screen: 'studio', studioTab: 'comments' },
  },
  {
    title: "Analytics: What's working (insights)",
    words: 'insights analytics retention watch time working best topics hours',
    target: { screen: 'stats', statsTab: 'working' },
  },
  {
    title: 'Studio: Research (Title Lab, competitors, trends)',
    words: 'research title lab keywords tags competitors trends ideas',
    target: { screen: 'studio', studioTab: 'research' },
  },
  {
    title: 'Studio: Publishing',
    words: 'publishing thumbnails platforms titles',
    target: { screen: 'studio', studioTab: 'publishing' },
  },
  {
    title: "Studio: Director's Log",
    words: 'log director history agents',
    target: { screen: 'studio', studioTab: 'log' },
  },
  {
    title: 'Channel Setup',
    words: 'channel brand setup add new colors slots shorts long form posting times pause archive',
    target: { screen: 'channels', channelsTab: 'setup' },
  },
  {
    title: 'Connections',
    words: 'connections youtube meta facebook instagram tiktok login connect health',
    target: { screen: 'channels', channelsTab: 'connections' },
  },
  {
    title: 'Other settings by channel',
    words: 'scheduling mode early handoff missed pipeline inbox hold cadence platforms flags per channel',
    target: { screen: 'channels', channelsTab: 'other' },
  },
  {
    title: 'Settings: Studio rules (retention, writing, thumbnails, limits)',
    words:
      'retention production writing checks thumbnail guidelines platform limits chapters public host qc',
    target: { screen: 'settings', settingsTab: 'studio' },
  },
  {
    title: 'AI Settings: Keys and mock mode',
    words: 'keys api gemini mock mode anthropic claude token',
    target: { screen: 'aiSettings' },
  },
  {
    title: 'AI Settings: Models and Local AI',
    words: 'models prices haiku sonnet ollama local ai text assist suggest whisper',
    target: { screen: 'aiSettings' },
  },
  {
    title: 'Settings: Alerts and backups',
    words: 'alerts backup restore imessage email telegram',
    target: { screen: 'settings', settingsTab: 'alerts' },
  },
  {
    title: 'AI Settings: Agent API',
    words: 'agent api mcp token grok bot',
    target: { screen: 'aiSettings' },
  },
  { title: 'New post', words: 'new post upload create', target: { screen: 'newPost' } },
  { title: 'Stats', words: 'stats views likes numbers', target: { screen: 'stats' } },
  { title: 'Activity log', words: 'activity log history', target: { screen: 'activity' } },
]
