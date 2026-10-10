import { formatEastern } from '@shared/time'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Empty, useBusy } from '../ui'

/** Bluesky posts, and the thumbnail A/B tests. */
export function StudioPublishing() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: social, reload } = useLoad(() => api.studio.socialPosts())
  const { data: tests, reload: reloadTests } = useLoad(() => api.studio.thumbTests())
  return (
    <div className="space-y-4">
      <Card title="Bluesky">
        <p className="mb-2 text-[12px] text-muted">These two are sent from here at the same time as the other platforms. A failed post is retried after 2, 10 and 30 minutes, then you get the usual alert.</p>
        {!social?.length ? (
          <Empty>Nothing yet. Turn Bluesky on for a brand in Settings.</Empty>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="text-muted"><tr><th>When</th><th>Platform</th><th>Post</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {social.map((p) => (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className="py-1">{formatEastern(p.scheduledAtUtc)}</td>
                  <td>{p.platform}</td>
                  <td className="max-w-[420px]"><div className="font-semibold">{p.title}</div><div className="text-muted">{p.text}</div>{p.error && <div className="text-bad">{p.error}</div>}</td>
                  <td>{p.status}{p.mock ? ' (mock)' : ''}{p.attempts ? ` after ${p.attempts} tries` : ''}{p.externalUrl && !p.mock ? <> <a className="text-accent" href={p.externalUrl} target="_blank" rel="noreferrer">open</a></> : null}</td>
                  <td>{p.status === 'failed' && <Button onClick={() => run(async () => { await api.studio.retrySocial(p.id); reload() })}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Thumbnail tests (YouTube long form)" actions={<Button disabled={busy} onClick={() => run(async () => { await api.studio.runThumbTests(); reloadTests(); toast({ kind: 'info', headline: 'Checked.' }) })}>Check now</Button>}>
        <p className="mb-2 text-[12px] text-muted">Each long video is posted with its best thumbnail. After about 48 hours and enough views the second best is swapped in, the click rate is compared, and the winner stays. Shorts cannot take a custom thumbnail through the API, so they use the opening frame instead.</p>
        {!tests?.length ? (
          <Empty>No tests yet.</Empty>
        ) : (
          tests.map((t) => (
            <div key={t.episodeId} className="mb-3 rounded-md border border-line p-3 text-[13px]">
              <div className="flex justify-between"><b>{t.episodeId}</b><span className="text-muted">{t.state}</span></div>
              {t.note && <div className="text-muted">{t.note}</div>}
              {t.variants.map((v) => (
                <div key={v.variant} className="mt-1">{v.winner ? 'WINNER ' : ''}{v.variant}: "{v.headline}", score {v.score.toFixed(2)}{v.ctr !== null ? `, click rate ${(v.ctr * 100).toFixed(1)} percent over ${v.impressions} impressions` : ''}</div>
              ))}
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
