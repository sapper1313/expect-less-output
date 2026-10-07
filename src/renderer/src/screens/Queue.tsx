import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern, localInputToIso } from '@shared/time'
import type { PostFilter } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { PostEditor } from '../components/PostEditor'
import {
  BrandDot,
  Button,
  Check,
  Confirm,
  Empty,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TargetChip,
  useBusy,
} from '../ui'

export function Queue() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [filter, setFilter] = useState<PostFilter>({
    status: 'upcoming',
    brandId: null,
    platform: null,
  })
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: posts } = useLoad(() => api.posts.list(filter), [JSON.stringify(filter)])
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [alsoFile, setAlsoFile] = useState(false)
  const [when, setWhen] = useState('')
  const [searchText, setSearchText] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, search: searchText })), 250)
    return () => clearTimeout(t)
  }, [searchText])

  const toggle = (id: number) => {
    const n = new Set(sel)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSel(n)
  }
  const ids = [...sel]

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.queue} />
      <div className="space-y-4 px-8">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            className="w-64"
            placeholder="Search title or caption"
            aria-label="Search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select
            className="w-52"
            aria-label="Brand"
            value={filter.brandId ?? ''}
            onChange={(e) =>
              setFilter({ ...filter, brandId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">All brands</option>
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-44"
            aria-label="Status"
            value={filter.status ?? 'all'}
            onChange={(e) =>
              setFilter({ ...filter, status: e.target.value as PostFilter['status'] })
            }
          >
            <option value="upcoming">Upcoming</option>
            <option value="recent">Recent</option>
            <option value="all">Everything</option>
            {[
              'draft',
              'scheduled',
              'in_progress',
              'partial',
              'posted',
              'failed',
              'missed',
              'canceled',
            ].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </Select>
          <Select
            className="w-44"
            aria-label="Platform"
            value={filter.platform ?? ''}
            onChange={(e) =>
              setFilter({ ...filter, platform: (e.target.value || null) as PostFilter['platform'] })
            }
          >
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>

        {ids.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
            <b>{ids.length} selected</b>
            <Input
              type="datetime-local"
              className="w-56"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="New time in Eastern"
            />
            <Button
              disabled={!when || busy}
              onClick={async () => {
                const iso = localInputToIso(when)!
                const ok = await run(async () => (await api.posts.reschedule(ids, iso), true))
                if (ok) {
                  toast({
                    kind: 'success',
                    headline: COPY.success,
                    detail: `${ids.length} post(s) moved to ${formatEastern(iso)}.`,
                  })
                  setSel(new Set())
                }
              }}
            >
              Reschedule
            </Button>
            <Button variant="danger" onClick={() => setConfirm('cancel')}>
              Cancel posts
            </Button>
            <Button variant="danger" onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          </div>
        )}

        {posts && posts.length === 0 ? (
          <Empty>{COPY.emptyQueue}</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface2 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="w-10 p-3" />
                  <th className="p-3">Post</th>
                  <th className="p-3">Brand</th>
                  <th className="p-3">When</th>
                  <th className="p-3">Platforms</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {posts?.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-t border-line hover:bg-surface"
                    onClick={() => setEditing(p.id)}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.title}`}
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={sel.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {p.posterUrl ? (
                          <img src={p.posterUrl} alt="" className="h-12 w-7 rounded object-cover" />
                        ) : (
                          <div className="h-12 w-7 rounded bg-surface2" />
                        )}
                        <div>
                          <div className="font-semibold">{p.title || p.fileName}</div>
                          <div className="text-[11px] text-muted">{p.fileName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <BrandDot color={p.brandColor} name={p.brandName} />
                    </td>
                    <td className="p-3">{formatEastern(p.scheduledAtUtc)}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {p.targets.map((t) => (
                          <TargetChip key={t.id} platform={t.platform} status={t.status} />
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <StatusBadge status={p.status} />
                      {p.targets.some((t) => t.lastError && t.status === 'failed') && (
                        <div className="mt-1 max-w-[260px] text-[11px] text-bad">
                          {p.targets.find((t) => t.status === 'failed')?.lastError}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing !== null && <PostEditor postId={editing} onClose={() => setEditing(null)} />}
      {confirm === 'cancel' && (
        <Confirm
          title="Cancel these posts?"
          message={`${COPY.confirm.cancelPost} (${ids.length} selected)`}
          confirmLabel="Cancel posts"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await run(() => api.posts.cancel(ids))
            setSel(new Set())
            setConfirm(null)
          }}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          title="Delete these posts?"
          message={`${COPY.confirm.deletePost} (${ids.length} selected)`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          extra={
            <Check checked={alsoFile} onChange={setAlsoFile}>
              Also delete the video files
            </Check>
          }
          onConfirm={async () => {
            await run(() => api.posts.remove(ids, alsoFile))
            setSel(new Set())
            setConfirm(null)
            setAlsoFile(false)
          }}
        />
      )}
    </div>
  )
}
