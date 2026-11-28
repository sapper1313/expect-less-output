import { COPY } from '@shared/copy'
import { useFetch, type VenturesData } from '../useVentures'
import { LinkOut, Note, when } from '../kit'

const ICON = { order: '🛒', review: '★', low_review: '⚠', message: '✉' } as const

export function Notifications({ data, storefront, onChange }: { data: VenturesData; storefront: string; onChange: () => void }) {
  const { data: rows, error, reload } = useFetch(() => data.notifications(storefront), [storefront])
  const unread = rows?.filter((n) => !n.read) ?? []
  return (
    <div className="space-y-2">
      {data.markRead && unread.length > 0 && (
        <button
          className="rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold"
          onClick={async () => {
            await data.markRead!(storefront, unread.map((n) => n.id))
            reload()
            onChange()
          }}
        >
          {COPY.ventures.markAllRead}
        </button>
      )}
      {error && <Note>{error}</Note>}
      {rows && rows.length === 0 && <Note>{COPY.ventures.emptyNotifications}</Note>}
      {rows?.map((n) => (
        <div key={n.id} className="flex gap-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
          <span aria-hidden className="w-5 text-center">
            {ICON[n.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-semibold">
              {!n.read && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-red-500" />}
              {n.title}
            </div>
            {n.detail && <div className="text-muted">{n.detail}</div>}
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
              <span>{when(n.at)}</span>
              {n.url && <LinkOut href={n.url}>{COPY.ventures.openOnEtsy}</LinkOut>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
