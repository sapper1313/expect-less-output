import { z } from 'zod'
import {
  ActivityOut,
  ActivityQuery,
  BrandOut,
  BrandStatsOut,
  BrandStatsQuery,
  CalendarOut,
  CalendarQuery,
  CreatePostBody,
  EpisodeIdParams,
  EpisodeOut,
  EpisodesOut,
  ListEpisodesQuery,
  HealthOut,
  IdParams,
  ListPostsQuery,
  NextOpenOut,
  NextOpenQuery,
  PostOut,
  PostStatsOut,
  RetryOut,
  UpdatePostBody,
} from './agentSchemas'

export interface RouteDef {
  id: string
  method: 'GET' | 'POST' | 'PATCH'
  /** OpenAPI style, for example /v1/posts/{id}. */
  path: string
  summary: string
  description?: string
  params?: z.ZodObject
  query?: z.ZodObject
  body?: z.ZodType
  response: z.ZodType
  success: 200 | 201
  /** Name of the MCP tool that wraps this route, if any. */
  tool?: string
  /** True when the route can put something on the schedule (checked against the drafts-only setting). */
  schedules?: boolean
}

export const ROUTES: RouteDef[] = [
  {
    id: 'listBrands',
    method: 'GET',
    path: '/v1/brands',
    summary: 'List brands with their slots, defaults and connected platforms.',
    response: z.object({ brands: z.array(BrandOut) }),
    success: 200,
    tool: 'list_brands',
  },
  {
    id: 'nextOpenSlots',
    method: 'GET',
    path: '/v1/slots/next-open',
    summary:
      'The next open posting slots for a brand (slots already taken by scheduled posts are skipped).',
    query: NextOpenQuery,
    response: NextOpenOut,
    success: 200,
    tool: 'get_next_open_slots',
  },
  {
    id: 'createPost',
    method: 'POST',
    path: '/v1/posts',
    summary:
      'Create a post from a video file. Creates a draft unless agents are allowed to schedule.',
    description:
      'The video is copied into the brand Queue folder. While the app setting "Agents may create drafts only" is on, asking for status scheduled or next_slot true is refused with HTTP 403 and code drafts_only. Nothing is silently downgraded.',
    body: CreatePostBody,
    response: PostOut,
    success: 201,
    tool: 'create_post',
    schedules: true,
  },
  {
    id: 'listPosts',
    method: 'GET',
    path: '/v1/posts',
    summary: 'List posts, newest schedule first.',
    query: ListPostsQuery,
    response: z.object({ posts: z.array(PostOut) }),
    success: 200,
    tool: 'list_posts',
  },
  {
    id: 'getPost',
    method: 'GET',
    path: '/v1/posts/{id}',
    summary: 'One post with the status of every platform.',
    params: IdParams,
    response: PostOut,
    success: 200,
    tool: 'get_post',
  },
  {
    id: 'updatePost',
    method: 'PATCH',
    path: '/v1/posts/{id}',
    summary: 'Change a post.',
    description:
      'While agents are limited to drafts, only drafts can be changed and status scheduled is refused with 403 drafts_only. Posts that are posting or posted cannot be changed.',
    params: IdParams,
    body: UpdatePostBody,
    response: PostOut,
    success: 200,
    tool: 'update_post',
    schedules: true,
  },
  {
    id: 'cancelPost',
    method: 'POST',
    path: '/v1/posts/{id}/cancel',
    summary: 'Cancel a post so it is not published. Nothing is deleted.',
    params: IdParams,
    response: PostOut,
    success: 200,
    tool: 'cancel_post',
  },
  {
    id: 'retryPost',
    method: 'POST',
    path: '/v1/posts/{id}/retry',
    summary: 'Retry every platform of a post that failed.',
    params: IdParams,
    response: RetryOut,
    success: 200,
    tool: 'retry_post',
  },
  {
    id: 'postStats',
    method: 'GET',
    path: '/v1/posts/{id}/stats',
    summary:
      'Views, likes, comments and shares for a posted video, per platform. Platforms that give no numbers say why.',
    params: IdParams,
    response: PostStatsOut,
    success: 200,
    tool: 'get_post_stats',
  },
  {
    id: 'brandStats',
    method: 'GET',
    path: '/v1/brands/{id}/stats',
    summary: 'Totals per platform for posts a brand published in the last 7 or 30 days.',
    params: IdParams,
    query: BrandStatsQuery,
    response: BrandStatsOut,
    success: 200,
    tool: 'get_brand_stats',
  },
  {
    id: 'calendar',
    method: 'GET',
    path: '/v1/calendar',
    summary: 'Scheduled posts as calendar events (canceled posts are left out).',
    query: CalendarQuery,
    response: CalendarOut,
    success: 200,
  },
  {
    id: 'activity',
    method: 'GET',
    path: '/v1/activity',
    summary: 'Recent activity log entries, newest first.',
    query: ActivityQuery,
    response: ActivityOut,
    success: 200,
  },
  {
    id: 'listEpisodes',
    method: 'GET',
    path: '/v1/episodes',
    summary: 'List studio episodes in the Library (read only). Filter by brand or status.',
    query: ListEpisodesQuery,
    response: EpisodesOut,
    success: 200,
    tool: 'list_episodes',
  },
  {
    id: 'getEpisode',
    method: 'GET',
    path: '/v1/episodes/{id}',
    summary:
      'One episode with its full package: scene prompts, dialogue, counted objects, title and description (read only).',
    params: EpisodeIdParams,
    response: EpisodeOut,
    success: 200,
    tool: 'get_episode',
  },
  {
    id: 'health',
    method: 'GET',
    path: '/v1/health',
    summary: 'Accounts, modes, quota and scheduler state.',
    response: HealthOut,
    success: 200,
    tool: 'get_health',
  },
]
