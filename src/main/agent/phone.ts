import { createHash, timingSafeEqual } from 'crypto'
import type { IncomingHttpHeaders } from 'http'
import pageHtml from '../../renderer/src/dashboard/page.html?raw'
import pageCss from '../../renderer/src/dashboard/dashboard.css?raw'
import viewJs from '../../renderer/src/dashboard/dashboardView.js?raw'
import themesCss from '../../renderer/src/dashboard/themes.css?raw'

/** What the read only phone page needs from the app. Nothing here can change anything. */
export interface PhoneProvider {
  token(): string | null
  /** The color theme name, for example 'midnight'. */
  look(): string
  snapshot(): Promise<unknown>
  refresh(): Promise<unknown>
  week(offset: number): Promise<unknown>
  tiles(): Promise<unknown>
}

export interface PhoneRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
  port: number
}

export interface PhoneResponse {
  status: number
  type: string
  body: string
}

const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

const BG: Record<string, string> = {
  midnight: '#060818',
  ocean: '#04111f',
  aurora: '#04140f',
  sunset: '#1a0a14',
  graphite: '#0c0d10',
  daylight: '#eaf0fb',
}

const safe = (s: string) => s.replace(/<\/(script|template)/gi, '<\\/$1')

/** The one page: the Home screen, in the user's color theme, loading its numbers from the same link. */
export function phonePage(look: string): string {
  const name = Object.keys(BG).includes(look) ? look : 'midnight'
  const loader = `
const base = location.pathname.replace(/\\/?$/, '/');
const get = async (file) => {
  const r = await fetch(base + file, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
const host = document.getElementById('host');
const root = host.attachShadow({ mode: 'open' });
root.appendChild(document.getElementById('pg').content.cloneNode(true));
mountDashboard(
  root,
  (force) => get(force ? 'snapshot.json?force=1' : 'snapshot.json'),
  () => get('tiles.json'),
  () => {},
  (offset) => get('week.json?offset=' + offset),
);
`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ELO Home">
<meta name="theme-color" content="${BG[name]}">
<meta name="robots" content="noindex">
<title>ELO Home</title>
<style>${safe(themesCss)}
html,body{margin:0;min-height:100%}
body{background:var(--g-bg);-webkit-text-size-adjust:100%}
#host{min-height:100vh;min-height:100dvh}</style>
</head>
<body class="glass-app" data-look="${name}">
<div id="host"></div>
<template id="pg"><style>${safe(pageCss)}</style>${safe(pageHtml)}</template>
<script type="module">
${safe(viewJs)}
${loader}
</script>
</body></html>`
}

const plain = (status: number, body: string): PhoneResponse => ({ status, type: 'text/plain; charset=utf-8', body })
const json = (body: unknown): PhoneResponse => ({
  status: 200,
  type: 'application/json; charset=utf-8',
  body: JSON.stringify(body ?? null),
})

/**
 * The read only phone page, at /m/<secret>/. Returns null when the path is not for this page.
 * A wrong secret looks exactly like a page that does not exist.
 */
export async function handlePhoneRequest(
  p: PhoneProvider,
  req: PhoneRequest,
  hostOk: (host: string) => boolean,
): Promise<PhoneResponse | null> {
  let url: URL
  try {
    url = new URL(req.url, `http://127.0.0.1:${req.port}`)
  } catch {
    return null
  }
  const m = /^\/m\/([^/]+)(?:\/(.*))?$/.exec(url.pathname)
  if (!m) return null
  const host = String(req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${req.port}` && host !== `localhost:${req.port}` && !hostOk(host))
    return plain(403, 'Not allowed.')
  const token = p.token()
  let given = ''
  try {
    given = decodeURIComponent(m[1] ?? '')
  } catch {
    // stays empty
  }
  if (!token || !given || !safeEqual(given, token)) return plain(404, 'Not found.')
  if (req.method !== 'GET') return plain(405, 'This page is read only.')
  const file = m[2] ?? ''
  try {
    if (file === '' ) return { status: 200, type: 'text/html; charset=utf-8', body: phonePage(p.look()) }
    if (file === 'snapshot.json')
      return json(url.searchParams.get('force') === '1' ? await p.refresh() : await p.snapshot())
    if (file === 'tiles.json') return json(await p.tiles())
    if (file === 'week.json') {
      const n = Number(url.searchParams.get('offset') ?? 0)
      return json(await p.week(Number.isInteger(n) && n >= 0 && n < 60 ? n : 0))
    }
  } catch {
    return plain(500, 'Something went wrong inside the app.')
  }
  return plain(404, 'Not found.')
}
