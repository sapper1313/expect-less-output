import type { Platform } from './platformLimits'

/**
 * The text each platform will actually receive: the shared caption (or that platform's own version).
 * YouTube also gets the title, and a #Shorts line when the brand setting is on.
 */
export function previewFor(
  platform: Platform,
  post: { title: string; caption: string },
  override: string | null,
  opts: { appendShorts: boolean },
): { title?: string; body: string } {
  const body = (override?.trim() ? override : post.caption).trim()
  if (platform !== 'youtube') return { body }
  let desc = body
  if (opts.appendShorts && !/#shorts\b/i.test(desc)) desc = `${desc}${desc ? '\n\n' : ''}#Shorts`
  return { title: post.title.trim(), body: desc }
}
