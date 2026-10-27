import { SITE_LINK_KEYS, type SiteLinkKey, type WebsiteProfile as Profile } from '@shared/website'
import type { Brand } from '@shared/types'
import { api } from '../api'
import { useApp, useDraft, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Textarea, useBusy } from '../ui'

const LINK_LABELS: Record<SiteLinkKey, string> = {
  youtube: 'YouTube link',
  tiktok: 'TikTok link',
  instagram: 'Instagram link',
  facebook: 'Facebook link',
  bluesky: 'Bluesky link',
}

type Draft = Pick<
  Profile,
  | 'siteSlug'
  | 'title'
  | 'host'
  | 'tagline'
  | 'description'
  | 'youtubeChannelId'
  | 'youtubeHandle'
  | 'accent'
  | 'links'
>

const draftOf = (p: Profile): Draft => ({
  siteSlug: p.siteSlug,
  title: p.title,
  host: p.host,
  tagline: p.tagline,
  description: p.description,
  youtubeChannelId: p.youtubeChannelId,
  youtubeHandle: p.youtubeHandle,
  accent: p.accent,
  links: p.links,
})

/** Where the repository lives, whether ELO publishes by itself, and the Pull and Publish buttons. */
function Connection() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: cfg, reload: reloadCfg } = useLoad(() => api.website.config())
  const { data: st, reload: reloadSt } = useLoad(() => api.website.status())
  const { draft: urlDraft, setDraft: setUrl } = useDraft(cfg ? cfg.repoUrl : null, 'website-url')
  if (!cfg || !st || urlDraft === null) return null
  const url = urlDraft
  const say = (r: { ok: boolean; message: string }) =>
    toast({
      kind: r.ok ? 'success' : 'error',
      headline: r.ok ? 'Website' : 'The website did not update.',
      detail: r.message,
    })
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 text-[13px] font-semibold">Website connection</div>
      <Check
        checked={cfg.autoPublish}
        onChange={async (v) => {
          await run(() => api.website.setConfig({ autoPublish: v }))
          reloadCfg()
        }}
      >
        Send changes to the website automatically
      </Check>
      <div className="ml-6 text-[12px] text-muted">
        About a minute after you save a change here, or archive a channel, ELO updates the site.
        Turn this off to send changes yourself with the button below.
      </div>
      <div className="mt-2 grid items-end gap-3 md:grid-cols-[1fr_auto]">
        <Field
          label="Website project on GitHub"
          hint="ELO keeps its own copy in its data folder, so you can move or delete the site folder on your Desktop."
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Button
          disabled={busy || url === cfg.repoUrl}
          onClick={async () => {
            if (await run(() => api.website.setConfig({ repoUrl: url }))) reloadCfg()
          }}
        >
          Save address
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.website.pull())
            if (r) say(r)
            reloadSt()
          }}
        >
          Fill ELO from the website
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.website.publish())
            if (r) say(r)
            reloadSt()
          }}
        >
          {st.waiting
            ? `Send ${st.waiting} change${st.waiting === 1 ? '' : 's'} to the website`
            : 'Send to the website now'}
        </Button>
      </div>
      <div className="mt-2 text-[12px] text-muted">
        {st.lastPublishAt
          ? `Last sent ${new Date(st.lastPublishAt).toLocaleString()}. `
          : 'Nothing sent yet. '}
        {st.lastPullAt ? `Last read ${new Date(st.lastPullAt).toLocaleString()}.` : ''}
      </div>
      {st.lastError && <div className="mt-1 text-[12px] text-bad">{st.lastError}</div>}
      {st.incomplete.length > 0 && (
        <div className="mt-1 text-[12px] text-warn">
          Not ready to go up:{' '}
          {st.incomplete.map((i) => `${i.name} (needs ${i.missing.join(', ')})`).join('; ')}.
        </div>
      )}
    </div>
  )
}

/** The channel's card on the public website: the check mark, the words, the links and the hero picture. */
export function WebsiteProfileCard({ brand }: { brand: Brand }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: p, reload } = useLoad(() => api.website.profile(brand.id), [brand.id])
  const { data: preview, reload: reloadPreview } = useLoad(
    () => api.website.heroPreview(brand.id),
    [brand.id, p?.heroImage, p?.heroPending],
  )
  // The page reloads whenever anything changes anywhere (including ELO sending to the site), so the typing lives in a
  // draft that is only replaced by the saved copy while it has not been edited.
  const { draft: d, setDraft: setD, dirty: edited } = useDraft(p ? draftOf(p) : null, brand.id)
  if (!p || !d) return null
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v })

  return (
    <Card title="Website">
      <Check
        checked={p.addToSite}
        onChange={async (v) => {
          if (await run(() => api.website.saveProfile(brand.id, { addToSite: v }))) reload()
        }}
      >
        Add to website?
      </Check>
      <div className="ml-6 text-[12px] text-muted">
        Shows this channel on expectlessmedia.com. Archiving the channel, or unticking this, takes
        it off the site.
        {p.addToSite && p.missing.length > 0 && (
          <span className="text-warn">
            {' '}
            Not on the site yet. Still needs: {p.missing.join(', ')}.
          </span>
        )}
        {p.dirty && p.missing.length === 0 && p.addToSite && (
          <span> A change is waiting to be sent.</span>
        )}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title on the site" hint="Can be longer than the channel name.">
              <Input value={d.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Host name(s)">
              <Input value={d.host} onChange={(e) => set('host', e.target.value)} />
            </Field>
          </div>
          <Field label="Tagline">
            <Input value={d.tagline} onChange={(e) => set('tagline', e.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea
              rows={5}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="YouTube channel id" hint="Starts with UC.">
              <Input
                value={d.youtubeChannelId}
                onChange={(e) => set('youtubeChannelId', e.target.value)}
              />
            </Field>
            <Field label="YouTube handle" hint="Like @clockoutearly.">
              <Input
                value={d.youtubeHandle}
                onChange={(e) => set('youtubeHandle', e.target.value)}
              />
            </Field>
            <Field label="Web address name" hint="Like clock-out-early.">
              <Input value={d.siteSlug} onChange={(e) => set('siteSlug', e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {SITE_LINK_KEYS.map((k) => (
              <Field key={k} label={LINK_LABELS[k]}>
                <Input
                  placeholder="https://"
                  value={d.links[k] ?? ''}
                  onChange={(e) => set('links', { ...d.links, [k]: e.target.value })}
                />
              </Field>
            ))}
            <Field label="Accent color">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : brand.color}
                  onChange={(e) => set('accent', e.target.value)}
                  className="h-9 w-16 rounded border border-line bg-bg"
                />
                <Input value={d.accent} onChange={(e) => set('accent', e.target.value)} />
              </div>
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={busy || !edited}
            onClick={async () => {
              if (await run(() => api.website.saveProfile(brand.id, d))) {
                reload()
                toast({
                  kind: 'success',
                  headline: 'Saved.',
                  detail: p.addToSite
                    ? 'It goes to the website in about a minute.'
                    : 'Not on the site until you tick Add to website.',
                })
              }
            }}
          >
            Save website details
          </Button>
        </div>

        <div>
          <div className="mb-1 text-[12px] font-semibold">Hero image</div>
          <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-line bg-bg">
            {preview ? (
              <img src={preview} alt="Hero" className="h-full w-full object-cover" />
            ) : (
              <span className="px-3 text-center text-[12px] text-muted">No picture yet</span>
            )}
          </div>
          <Button
            className="mt-2"
            disabled={busy}
            onClick={async () => {
              const files = await api.media.pickImages(false)
              if (!files[0]) return
              if (await run(() => api.website.setHero(brand.id, files[0]))) {
                reload()
                reloadPreview()
              }
            }}
          >
            {p.heroImage ? 'Change picture' : 'Pick picture'}
          </Button>
          <div className="mt-1 text-[11px] text-muted">
            PNG, JPG or WebP under 8 MB.{' '}
            {p.heroPending ? 'New picture waiting to be sent.' : p.heroImage}
          </div>
        </div>
      </div>
      <Connection />
    </Card>
  )
}
