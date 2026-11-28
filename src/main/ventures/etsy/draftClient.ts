import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { DraftClient, DraftFields } from '../drafts'
import type { EtsyClient } from './client'

/** Etsy wants dollars with two decimals. */
const dollars = (cents: number) => (cents / 100).toFixed(2)

const form = (f: Partial<DraftFields>): URLSearchParams => {
  const p = new URLSearchParams()
  if (f.title !== undefined) p.set('title', f.title)
  if (f.description !== undefined) p.set('description', f.description)
  if (f.priceCents !== undefined) p.set('price', dollars(f.priceCents))
  if (f.quantity !== undefined) p.set('quantity', String(f.quantity))
  if (f.taxonomyId !== undefined) p.set('taxonomy_id', String(f.taxonomyId))
  if (f.tags !== undefined) p.set('tags', f.tags.join(','))
  // Never `state`: Etsy makes new listings drafts, and nothing here may publish one.
  return p
}

async function bytes(src: string): Promise<{ data: Buffer; name: string }> {
  if (/^https:\/\//i.test(src)) {
    const r = await fetch(src)
    if (!r.ok) throw new Error('An image link could not be downloaded.')
    return { data: Buffer.from(await r.arrayBuffer()), name: basename(new URL(src).pathname) || 'image.jpg' }
  }
  return { data: readFileSync(src), name: basename(src) }
}

/** Creates and changes draft listings on Etsy, with their pictures and digital file. */
export function etsyDraftClient(client: EtsyClient): DraftClient {
  return {
    async createDraft(shopId, f) {
      const body = form(f)
      body.set('who_made', 'i_did')
      body.set('when_made', 'made_to_order')
      if (f.digitalFile) body.set('type', 'download')
      const made = await client.send<{ listing_id: number }>('POST', `/v3/application/shops/${shopId}/listings`, body)
      const id = String(made.listing_id)
      for (const [i, src] of f.images.entries()) {
        const { data, name } = await bytes(src)
        const fd = new FormData()
        fd.set('image', new Blob([new Uint8Array(data)]), name)
        fd.set('rank', String(i + 1))
        await client.send('POST', `/v3/application/shops/${shopId}/listings/${id}/images`, fd)
      }
      if (f.digitalFile) {
        const { data, name } = await bytes(f.digitalFile)
        const fd = new FormData()
        fd.set('file', new Blob([new Uint8Array(data)]), name)
        fd.set('name', name)
        await client.send('POST', `/v3/application/shops/${shopId}/listings/${id}/files`, fd)
      }
      return { listingId: id }
    },
    async updateDraft(shopId, listingId, f) {
      await client.send('PATCH', `/v3/application/shops/${shopId}/listings/${listingId}`, form(f))
    },
  }
}
