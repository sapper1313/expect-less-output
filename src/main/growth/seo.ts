import { parseSuggestions } from '@shared/growth'

/**
 * Search phrases from YouTube's public autocomplete for the words given. Only those words leave the Mac, to Google's
 * suggestion address. Returns [] when the address cannot be reached.
 */
export async function fetchSuggestions(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const q = query.trim().slice(0, 100)
  if (!q) return []
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []
    return parseSuggestions(await res.json()).slice(0, 10)
  } catch {
    return []
  }
}
