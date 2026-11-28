import { AgentError } from '../agent/core'
import { isOperator } from '../agent/bethActions'
import type { Caller } from '../agent/bots'
import type { DraftListingInput, UpdateDraftInput } from '@shared/agentSchemas'
import type { ListingDetail } from '@shared/ventures'
import type { VentureStore } from './store'

const SF = 'etsy'

/** What Etsy needs to make or change a draft. There is no state in here on purpose: drafts stay drafts. */
export interface DraftFields {
  title: string
  description: string
  tags: string[]
  priceCents: number
  quantity: number
  taxonomyId: number
  images: string[]
  digitalFile?: string
}

export interface DraftClient {
  createDraft(shopId: string, fields: DraftFields): Promise<{ listingId: string }>
  updateDraft(shopId: string, listingId: string, fields: Partial<DraftFields>): Promise<void>
}

export interface DraftDeps {
  store: VentureStore
  /** The connected shop, or null while only sample data exists. */
  live: () => { client: DraftClient; shopId: string } | null
  audit: { write(e: { actor: string; action: string; target?: string; after?: unknown }): void }
  /** A category to use when a draft does not name one. */
  defaultTaxonomy: () => number | null
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
  constructor(private d: DraftDeps) {}

  private deny(caller: Caller, target: string, code: 'forbidden' | 'drafts_only', message: string): never {
    this.d.audit.write({ actor: who(caller), action: 'api.denied', target, after: { reason: message } })
    throw new AgentError(403, code, message)
  }

  private requireOperator(caller: Caller, target: string) {
    if (caller.kind === 'owner') return
    if (!isOperator(caller.bot)) this.deny(caller, target, 'forbidden', "Only the orchestrator token (beth) or the owner's token may change Etsy drafts.")
  }

  private log(caller: Caller, action: string, listingId: string, fields: string[], pending: boolean) {
    this.d.audit.write({ actor: who(caller), action, target: `etsy listing ${listingId}`, after: { fields, pending } })
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

  async create(caller: Caller, input: DraftListingInput): Promise<DraftResult> {
    this.requireOperator(caller, 'etsy draft create')
    const fields = Object.keys(input)
    const live = this.d.live()
    const f = this.toFields(input)
    if (live && f) {
      const { listingId } = await live.client.createDraft(live.shopId, f)
      this.log(caller, 'ventures.draft.create', listingId, fields, false)
      return { id: listingId, state: 'draft', pending: false }
    }
    const rowId = this.d.store.addPending(SF, 'create', '', input)
    const localId = `pending-${rowId}`
    this.d.store.setPendingTarget(rowId, localId)
    this.d.store.upsertListing(SF, this.localListing(localId, input))
    this.log(caller, 'ventures.draft.create', localId, fields, true)
    return { id: localId, state: 'draft', pending: true }
  }

  async update(caller: Caller, id: string, patch: UpdateDraftInput): Promise<DraftResult> {
    this.requireOperator(caller, `etsy draft ${id} update`)
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
    if (cached.state !== 'draft') this.deny(caller, `etsy listing ${id} update`, 'drafts_only', 'Only drafts can be changed here.')
    const live = this.d.live()
    if (live) {
      const f: Partial<DraftFields> = { ...patch }
      await live.client.updateDraft(live.shopId, id, f)
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
          if (!f) throw new Error('This draft needs a category (taxonomyId).')
          await live.client.createDraft(live.shopId, f)
          this.d.store.deleteListing(SF, p.targetId)
        } else {
          await live.client.updateDraft(live.shopId, p.targetId, p.payload)
        }
        this.d.store.deletePending(p.id)
        this.d.audit.write({ actor: 'system', action: 'ventures.draft.pushed', target: `etsy listing ${p.targetId}`, after: { kind: p.kind } })
        pushed++
      } catch (e) {
        this.d.store.failPending(p.id, e instanceof Error ? e.message : 'Etsy refused it.')
        failed++
      }
    }
    return { pushed, failed }
  }
}
