import { AgentError } from '../agent/core'
import { isOperator } from '../agent/bethActions'
import type { Caller } from '../agent/bots'
import type { DraftListingInput, UpdateDraftInput } from '@shared/agentSchemas'
import type { ListingDetail } from '@shared/ventures'
import type { VentureStore } from './store'

const SF = 'etsy'

/** What Etsy needs to make a draft. There is no state in here on purpose: drafts stay drafts. */
export interface DraftFields {
  title: string
  description: string
  tags: string[]
  priceCents: number
  quantity: number
  taxonomyId: number
  shippingProfileId?: number
  images: string[]
  digitalFile?: string
}
export type DraftChange = Partial<Pick<DraftFields, 'title' | 'description' | 'tags' | 'priceCents' | 'quantity' | 'taxonomyId' | 'shippingProfileId'>>

/** The listing was made on Etsy but a picture or the file did not go up. Retrying must finish it, not make another. */
export class PartialDraftError extends Error {
  constructor(readonly listingId: string) {
    super('The draft was made on Etsy but a picture or file did not upload.')
  }
}

export interface DraftClient {
  /** With `existingListingId` it only finishes the pictures and file of a listing that already exists. */
  createDraft(shopId: string, fields: DraftFields, existingListingId?: string): Promise<{ listingId: string }>
  updateDraft(shopId: string, listingId: string, fields: DraftChange): Promise<void>
  /** Etsy's own answer for a listing's state (the local copy can be 20 minutes old). */
  listingState(listingId: string): Promise<string | null>
}

export interface DraftDeps {
  store: VentureStore
  /** The connected shop, or null while only sample data exists. */
  live: () => { client: DraftClient; shopId: string } | null
  audit: { write(e: { actor: string; action: string; target?: string; after?: unknown }): void }
  /** Defaults for a draft that does not name a category or shipping profile. */
  defaultTaxonomy: () => number | null
  defaultShippingProfile: () => number | null
  /** Throws a plain Error when a picture or file is not allowed. Never mentions the path. */
  checkFiles?: (f: { images: string[]; digitalFile?: string }) => Promise<void>
}

export interface DraftResult {
  id: string
  state: 'draft'
  pending: boolean
}

const who = (c: Caller) => (c.kind === 'owner' ? 'josh' : c.actor)

/**
 * B.E.T.H.'s write access to Etsy: create and change drafts, nothing else. Every call, allowed or refused, is logged
 * with who, what and when. File paths and file contents are never logged, only the names of the fields.
 */
export class DraftService {
  private audited = new WeakSet<object>()
  constructor(private d: DraftDeps) {}

  private deny(caller: Caller, target: string, code: 'forbidden' | 'drafts_only' | 'validation', message: string, status = 403): never {
    this.d.audit.write({ actor: who(caller), action: 'api.denied', target, after: { reason: message } })
    const e = new AgentError(status, code, message)
    this.audited.add(e)
    throw e
  }

  /** Runs one call. Anything that goes wrong is logged as a refusal once and comes out as a plain message. */
  private async guard<T>(caller: Caller, target: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof Error && this.audited.has(e)) throw e
      const known = e instanceof AgentError
      const message = known ? e.message : 'Etsy did not confirm the change. Check Etsy before trying again.'
      this.d.audit.write({ actor: who(caller), action: 'api.denied', target, after: { reason: message } })
      throw known ? e : new AgentError(500, 'server_error', message)
    }
  }

  private requireOperator(caller: Caller, target: string) {
    if (caller.kind === 'owner') return
    if (!isOperator(caller.bot)) this.deny(caller, target, 'forbidden', "Only the orchestrator token (beth) or the owner's token may change Etsy drafts.")
  }

  private log(caller: Caller, action: string, listingId: string, fields: string[], pending: boolean) {
    this.d.audit.write({ actor: who(caller), action, target: `etsy listing ${listingId}`, after: { fields, pending } })
  }

  private async checkFiles(caller: Caller, target: string, f: { images?: string[]; digitalFile?: string }) {
    if (!f.images?.length && !f.digitalFile) return
    try {
      await this.d.checkFiles?.({ images: f.images ?? [], digitalFile: f.digitalFile })
    } catch (e) {
      this.deny(caller, target, 'validation', e instanceof Error ? e.message : 'A picture or file is not allowed.', 400)
    }
  }

  private toFields(i: DraftListingInput): DraftFields | null {
    const taxonomyId = i.taxonomyId ?? this.d.defaultTaxonomy()
    if (!taxonomyId) return null
    return {
      title: i.title,
      description: i.description,
      tags: i.tags,
      priceCents: i.priceCents,
      quantity: i.quantity ?? 999,
      taxonomyId,
      shippingProfileId: i.shippingProfileId ?? this.d.defaultShippingProfile() ?? undefined,
      images: i.images,
      digitalFile: i.digitalFile,
    }
  }

  private localListing(id: string, i: Pick<DraftListingInput, 'title' | 'description' | 'tags' | 'priceCents'> & { quantity?: number }): ListingDetail {
    return {
      id,
      title: i.title,
      thumbUrl: null,
      priceCents: i.priceCents,
      currency: 'USD',
      views: 0,
      favorites: 0,
      quantity: i.quantity ?? 999,
      state: 'draft',
      url: '',
      description: i.description,
      tags: i.tags,
      images: [],
      priceHistory: [],
      sales: 0,
    }
  }

  private queueCreate(input: DraftListingInput & { etsyId?: string }): string {
    const rowId = this.d.store.addPending(SF, 'create', '', input)
    const localId = `pending-${rowId}`
    this.d.store.setPendingTarget(rowId, localId)
    this.d.store.upsertListing(SF, this.localListing(localId, input))
    return localId
  }

  async create(caller: Caller, input: DraftListingInput): Promise<DraftResult> {
    const target = 'etsy draft create'
    return this.guard(caller, target, async () => {
      this.requireOperator(caller, target)
      await this.checkFiles(caller, target, input)
      const fields = Object.keys(input)
      const live = this.d.live()
      const f = this.toFields(input)
      if (live && f) {
        try {
          const { listingId } = await live.client.createDraft(live.shopId, f)
          this.d.store.upsertListing(SF, { ...this.localListing(listingId, input), url: `https://www.etsy.com/listing/${listingId}` })
          this.log(caller, 'ventures.draft.create', listingId, fields, false)
          return { id: listingId, state: 'draft', pending: false }
        } catch (e) {
          if (!(e instanceof PartialDraftError)) throw e
          // The listing exists on Etsy. Keep it so a retry only finishes the pictures and never makes a second one.
          const localId = this.queueCreate({ ...input, etsyId: e.listingId } as DraftListingInput)
          this.log(caller, 'ventures.draft.create', e.listingId, fields, true)
          return { id: localId, state: 'draft', pending: true }
        }
      }
      const localId = this.queueCreate(input)
      this.log(caller, 'ventures.draft.create', localId, fields, true)
      return { id: localId, state: 'draft', pending: true }
    })
  }

  async update(caller: Caller, id: string, patch: UpdateDraftInput): Promise<DraftResult> {
    const target = `etsy draft ${id} update`
    return this.guard(caller, target, async () => {
      this.requireOperator(caller, target)
      const fields = Object.keys(patch)
      if (id.startsWith('pending-')) {
        const row = this.d.store.listPending(SF).find((p) => p.kind === 'create' && p.targetId === id)
        if (!row) throw new AgentError(404, 'not_found', 'No pending draft with that id.')
        const merged = { ...row.payload, ...patch }
        this.d.store.updatePending(row.id, merged)
        this.d.store.upsertListing(SF, this.localListing(id, merged))
        this.log(caller, 'ventures.draft.update', id, fields, true)
        return { id, state: 'draft', pending: true }
      }
      const cached = this.d.store.getListing(SF, id)
      if (!cached) throw new AgentError(404, 'not_found', 'ELO has not seen that listing yet. Wait for the next Etsy sync.')
      if (cached.state !== 'draft') this.deny(caller, target, 'drafts_only', 'Only drafts can be changed here.')
      const live = this.d.live()
      if (live) {
        // The local copy can be 20 minutes old. Etsy's own answer decides.
        const state = await live.client.listingState(id)
        if (state !== 'draft') this.deny(caller, target, 'drafts_only', 'Only drafts can be changed here.')
        await live.client.updateDraft(live.shopId, id, { ...patch })
        this.d.store.upsertListing(SF, {
          ...cached,
          title: patch.title ?? cached.title,
          description: patch.description ?? cached.description,
          tags: patch.tags ?? cached.tags,
          priceCents: patch.priceCents ?? cached.priceCents,
        })
        this.log(caller, 'ventures.draft.update', id, fields, false)
        return { id, state: 'draft', pending: false }
      }
      this.d.store.addPending(SF, 'update', id, patch)
      this.log(caller, 'ventures.draft.update', id, fields, true)
      return { id, state: 'draft', pending: true }
    })
  }

  /** Sends everything that was waiting, always as drafts. A failure keeps the item and records why. */
  async pushPending(): Promise<{ pushed: number; failed: number }> {
    const live = this.d.live()
    if (!live) return { pushed: 0, failed: 0 }
    let pushed = 0
    let failed = 0
    for (const p of this.d.store.listPending(SF)) {
      try {
        if (p.kind === 'create') {
          const f = this.toFields(p.payload)
          if (!f) throw new Error('This draft needs a category. Set a default category or send taxonomyId.')
          await live.client.createDraft(live.shopId, f, p.payload.etsyId)
          this.d.store.deleteListing(SF, p.targetId)
        } else {
          const state = await live.client.listingState(p.targetId)
          if (state !== 'draft') {
            this.d.audit.write({ actor: 'system', action: 'api.denied', target: `etsy listing ${p.targetId} update`, after: { reason: 'Only drafts can be changed here.' } })
            this.d.store.deletePending(p.id)
            failed++
            continue
          }
          await live.client.updateDraft(live.shopId, p.targetId, p.payload)
        }
        this.d.store.deletePending(p.id)
        this.d.audit.write({ actor: 'system', action: 'ventures.draft.pushed', target: `etsy listing ${p.targetId}`, after: { kind: p.kind } })
        pushed++
      } catch (e) {
        if (e instanceof PartialDraftError) this.d.store.updatePending(p.id, { ...p.payload, etsyId: e.listingId })
        this.d.store.failPending(p.id, e instanceof PartialDraftError ? e.message : e instanceof Error && /category/.test(e.message) ? e.message : 'Etsy did not accept it. It will be tried again.')
        failed++
      }
    }
    return { pushed, failed }
  }
}
