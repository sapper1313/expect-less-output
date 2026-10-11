export type SearchKind = 'episode' | 'post' | 'idea' | 'comment' | 'bible' | 'log' | 'page'

export interface SearchTarget {
  screen:
    | 'home'
    | 'calendar'
    | 'queue'
    | 'studio'
    | 'channels'
    | 'newPost'
    | 'stats'
    | 'settings'
    | 'activity'
  studioTab?: string
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
  { title: 'Calendar', words: 'calendar schedule month week', target: { screen: 'calendar' } },
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
    title: 'Studio: Spend',
    words: 'spend money cost budget cap',
    target: { screen: 'studio', studioTab: 'spend' },
  },
  {
    title: 'Studio: Comments',
    words: 'comments replies',
    target: { screen: 'studio', studioTab: 'comments' },
  },
  {
    title: 'Studio: Insights',
    words: 'insights analytics retention watch time',
    target: { screen: 'studio', studioTab: 'insights' },
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
    title: 'Channel setup',
    words: 'channel brand setup colors slots hashtags defaults',
    target: { screen: 'channels', channelsTab: 'setup' },
  },
  {
    title: 'Connections',
    words: 'connections youtube meta facebook instagram tiktok login connect health',
    target: { screen: 'channels', channelsTab: 'connections' },
  },
  {
    title: 'Studio settings per channel',
    words: 'cadence bluesky platforms flags per channel',
    target: { screen: 'channels', channelsTab: 'studio' },
  },
  {
    title: 'Settings: Studio (keys, spend caps, retention)',
    words:
      'keys api spend caps retention mock mode production writing checks thumbnail guidelines platform limits',
    target: { screen: 'settings', settingsTab: 'studio' },
  },
  {
    title: 'Settings: AI models and Local AI',
    words: 'models prices haiku sonnet ollama local ai text assist suggest whisper',
    target: { screen: 'settings', settingsTab: 'ai' },
  },
  {
    title: 'Settings: Alerts and backup',
    words: 'alerts backup restore imessage email telegram',
    target: { screen: 'settings', settingsTab: 'alerts' },
  },
  {
    title: 'Settings: Agent API',
    words: 'agent api mcp token grok bot',
    target: { screen: 'settings', settingsTab: 'api' },
  },
  { title: 'New post', words: 'new post upload create', target: { screen: 'newPost' } },
  { title: 'Stats', words: 'stats views likes numbers', target: { screen: 'stats' } },
  { title: 'Activity log', words: 'activity log history', target: { screen: 'activity' } },
]
