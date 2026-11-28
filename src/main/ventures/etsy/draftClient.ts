import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, sep } from 'node:path'
import { PartialDraftError, type DraftChange, type DraftClient, type DraftFields } from '../drafts'
import type { EtsyClient } from './client'

const MAX_BYTES = 20 * 1024 * 1024 // Etsy's limit per file
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
/** One message for every file problem. It never says which path, so a log cannot leak where files live. */
const NOT_ALLOWED = 'A picture or file is missing, too big, the wrong type, or not in an allowed folder.'

/** Etsy wants dollars with two decimals. */
const dollars = (cents: number) => (cents / 100).toFixed(2)

const form = (f: DraftChange & Partial<Pick<DraftFields, 'taxonomyId'>>): URLSearchParams => {
  const p = new URLSearchParams()
  if (f.title !== undefined) p.set('title', f.title)
  if (f.description !== undefined) p.set('description', f.description)
  if (f.priceCents !== undefined) p.set('price', dollars(f.priceCents))
  if (f.quantity !== undefined) p.set('quantity', String(f.quantity))
  if (f.taxonomyId !== undefined) p.set('taxonomy_id', String(f.taxonomyId))
  if (f.shippingProfileId !== undefined) p.set('shipping_profile_id', String(f.shippingProfileId))
  if (f.tags !== undefined) p.set('tags', f.tags.join(','))
  // Never `state`: Etsy makes new listings drafts, and nothing here may publish one.
  return p
}

/** A link a bot gave us must be https and point at the public internet, never at this Mac or the home network. */
export function isPublicHttps(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224)
  }
  if (h.includes(':')) return false // IPv6 addresses are not accepted at all
  return true
}

/** The real path of a local file, only if it sits inside one of the allowed folders (symlinks are followed first). */
function resolveLocal(src: string, roots: string[]): string {
  let real: string
  try {
    real = realpathSync(src)
  } catch {
    throw new Error(NOT_ALLOWED)
  }
  const inside = roots.some((r) => {
    try {
      const root = realpathSync(r)
      return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep)
    } catch {
      return false
    }
  })
  if (!inside) throw new Error(NOT_ALLOWED)
  const st = statSync(real)
  if (!st.isFile() || st.size > MAX_BYTES) throw new Error(NOT_ALLOWED)
  return real
}

/** Checks pictures and the digital file without reading them into memory. Throws one plain message on any problem. */
export function checkFilesIn(roots: () => string[]) {
  return async (f: { images: string[]; digitalFile?: string }): Promise<void> => {
    for (const src of f.images) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) {
        if (!isPublicHttps(src)) throw new Error(NOT_ALLOWED)
        continue
      }
      const real = resolveLocal(src, roots())
      if (!IMAGE_EXT.has(extname(real).toLowerCase())) throw new Error(NOT_ALLOWED)
    }
    if (f.digitalFile) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(f.digitalFile)) throw new Error(NOT_ALLOWED)
      resolveLocal(f.digitalFile, roots())
    }
  }
}

export interface DraftClientOpts {
  roots: () => string[]
  fetch?: typeof fetch
}

/** Creates and changes draft listings on Etsy, with their pictures and digital file. */
export function etsyDraftClient(client: EtsyClient, opts: DraftClientOpts = { roots: () => [] }): DraftClient {
  const check = checkFilesIn(opts.roots)

  async function load(src: string, image: boolean): Promise<{ data: Buffer; name: string }> {
    if (/^https:\/\//i.test(src)) {
      if (!isPublicHttps(src)) throw new Error(NOT_ALLOWED)
      const r = await (opts.fetch ?? fetch)(src, { redirect: 'error' })
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(NOT_ALLOWED)
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_BYTES) throw new Error(NOT_ALLOWED)
      return { data: buf, name: basename(new URL(src).pathname) || 'image.jpg' }
    }
    const real = resolveLocal(src, opts.roots())
    if (image && !IMAGE_EXT.has(extname(real).toLowerCase())) throw new Error(NOT_ALLOWED)
    return { data: readFileSync(real), name: basename(real) }
  }

  return {
    async createDraft(shopId, f, existingListingId) {
      // Read and check every picture and file first, so a bad one stops us before anything exists on Etsy.
      await check({ images: f.images, digitalFile: f.digitalFile })
      const images = await Promise.all(f.images.map((s) => load(s, true)))
      const file = f.digitalFile ? await load(f.digitalFile, false) : null

      let id = existingListingId
      if (!id) {
        const body = form(f)
        body.set('who_made', 'i_did')
        body.set('is_supply', 'false')
        body.set('when_made', 'made_to_order')
        if (f.digitalFile) body.set('type', 'download')
        const made = await client.send<{ listing_id: number }>('POST', `/v3/application/shops/${shopId}/listings`, body)
        id = String(made.listing_id)
      }
      try {
        // On a retry, skip what already went up so nothing is added twice.
        const have = existingListingId
          ? ((await client.get<{ results?: unknown[] }>(`/v3/application/listings/${id}/images`)).results?.length ?? 0)
          : 0
        for (const [i, im] of images.entries()) {
          if (i < have) continue
          const fd = new FormData()
          fd.set('image', new Blob([new Uint8Array(im.data)]), im.name)
          fd.set('rank', String(i + 1))
          await client.send('POST', `/v3/application/shops/${shopId}/listings/${id}/images`, fd)
        }
        if (file) {
          const files = existingListingId
            ? ((await client.get<{ results?: unknown[] }>(`/v3/application/shops/${shopId}/listings/${id}/files`)).results?.length ?? 0)
            : 0
          if (!files) {
            const fd = new FormData()
            fd.set('file', new Blob([new Uint8Array(file.data)]), file.name)
            fd.set('name', file.name)
            await client.send('POST', `/v3/application/shops/${shopId}/listings/${id}/files`, fd)
          }
        }
      } catch {
        throw new PartialDraftError(id)
      }
      return { listingId: id }
    },
    async updateDraft(shopId, listingId, f) {
      await client.send('PATCH', `/v3/application/shops/${shopId}/listings/${listingId}`, form(f))
    },
    async listingState(listingId) {
      const r = await client.get<{ state?: string }>(`/v3/application/listings/${listingId}`)
      return r.state ?? null
    },
  }
}
