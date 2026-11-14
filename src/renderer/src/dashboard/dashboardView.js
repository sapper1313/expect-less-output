/* eslint-disable */
// @ts-nocheck
// The As Expected. dashboard page logic, run inside a shadow root so its styles stay apart from ELO's.

// Real platform logos, fixed markup (never built from data). Used on this page and by the app screens.
const LOGOS = {
  youtube: '<rect width="24" height="24" rx="6" fill="#FF0000"/><path d="M9.6 7.8v8.4l7.2-4.2z" fill="#fff"/>',
  facebook: '<circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M13.4 19.6v-6.2h2.1l.4-2.6h-2.5V9.3c0-.8.3-1.3 1.4-1.3h1.2V5.7c-.2 0-1-.1-1.9-.1-2 0-3.3 1.200-3.300 3.400v1.800H8.700v2.600h2.100v6.200z" fill="#fff"/>',
  instagram: '<defs><linearGradient id="eloig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset=".85" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect width="24" height="24" rx="6.5" fill="url(#eloig)"/><rect x="5.6" y="5.6" width="12.8" height="12.8" rx="3.8" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="16.3" cy="7.7" r="1" fill="#fff"/>',
  tiktok: '<rect width="24" height="24" rx="6" fill="#000"/><g transform="translate(0 .3)"><path transform="translate(-.6 -.5)" fill="#25F4EE" d="M16.600 5.900c-.7-.5-1.200-1.300-1.300-2.200h-2.400v10.300c0 1.200-1 2-2 2-1.200 0-2.100-1-2-2.100.1-1.100 1.100-2 2.300-1.900.2 0 .4 0 .6.100V9.500c-.2 0-.4-.1-.6-.1-2.500-.1-4.600 1.900-4.600 4.400 0 2.400 1.900 4.400 4.400 4.400s4.400-1.900 4.400-4.400V9.300c.9.600 1.900 1 3 1V7.900c-.9 0-1.800-.4-2.400-1z"/><path transform="translate(.6 .5)" fill="#FE2C55" d="M16.600 5.900c-.7-.5-1.200-1.300-1.300-2.200h-2.400v10.300c0 1.200-1 2-2 2-1.200 0-2.100-1-2-2.100.1-1.100 1.100-2 2.300-1.900.2 0 .4 0 .6.100V9.500c-.2 0-.4-.1-.6-.1-2.500-.1-4.600 1.900-4.600 4.400 0 2.400 1.900 4.400 4.400 4.400s4.400-1.900 4.400-4.400V9.300c.9.600 1.900 1 3 1V7.900c-.9 0-1.800-.4-2.400-1z"/><path fill="#fff" d="M16.600 5.900c-.7-.5-1.200-1.300-1.300-2.200h-2.400v10.300c0 1.200-1 2-2 2-1.200 0-2.100-1-2-2.100.1-1.100 1.100-2 2.300-1.900.2 0 .4 0 .6.100V9.500c-.2 0-.4-.1-.6-.1-2.500-.1-4.600 1.900-4.600 4.400 0 2.400 1.900 4.400 4.400 4.400s4.400-1.900 4.400-4.400V9.300c.9.600 1.900 1 3 1V7.900c-.9 0-1.800-.4-2.400-1z"/></g>',
  bluesky: '<g transform="translate(0 2.2) scale(.9) translate(1.3 0)"><path fill="#1185FE" d="M12 10.800c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.080 0 3.768c0 .69.378 5.650.624 6.479.815 2.736 3.713 3.660 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.040-.415.056-3.912.580-7.387 2.005-2.830 7.078 5.013 5.190 6.870-1.113 7.823-4.308.953 3.195 2.050 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.740-7.078a8.741 8.741 0 0 1-.415-.056c.140.017.279.036.415.056 2.670.297 5.568-.628 6.383-3.364.246-.828.624-5.790.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.620-4.300 1.240C16.046 4.748 13.087 8.687 12 10.800Z"/></g>',
  x: '<rect width="24" height="24" rx="6" fill="#000"/><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  linkedin: '<rect width="24" height="24" rx="5" fill="#0A66C2"/><path fill="#fff" d="M6.200 9.600h2.400V18H6.200zM7.400 5.800a1.400 1.400 0 1 1 0 2.800 1.400 1.400 0 0 1 0-2.800zM10.200 9.600h2.300v1.100c.4-.7 1.300-1.300 2.500-1.300 2.500 0 3 1.600 3 3.800V18h-2.400v-4.200c0-1 0-2.200-1.400-2.200s-1.600 1.100-1.600 2.200V18h-2.400z"/>',
  pinterest: '<circle cx="12" cy="12" r="12" fill="#E60023"/><path fill="#fff" d="M12.200 5.500c-3.300 0-5 2.200-5 4.600 0 1.100.6 2.500 1.600 2.900.2.100.3 0 .3-.2l.2-.9c0-.1 0-.2-.1-.3-.3-.4-.5-1-.5-1.700 0-1.700 1.300-3.300 3.400-3.300 1.900 0 3.200 1.300 3.200 3.100 0 2-1 3.500-2.400 3.500-.8 0-1.300-.6-1.100-1.400.2-.9.6-1.900.6-2.500 0-.6-.3-1.100-1-1.100-.8 0-1.400.8-1.400 1.900 0 .7.200 1.200.2 1.200l-.9 3.800c-.2.900 0 2.200 0 2.300 0 .1.100.1.200 0 .1-.1 1.100-1.400 1.400-2.600l.6-2.200c.3.600 1.200 1.100 2.100 1.100 2.800 0 4.700-2.500 4.700-5.800 0-2.500-2.100-4.800-5.400-4.800z"/>'
};
export function platformLogo(platform, size) {
  const inner = LOGOS[platform];
  const px = size || 18;
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" role="img" aria-label="${platform}" style="flex:none;display:block">${inner}</svg>`;
}

export function mountDashboard(root, loadSnapshot, loadTiles, onGo, loadWeek) {
// All dynamic text goes through textContent. Nothing from the snapshot is ever parsed as HTML.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const $ = (id) => root.getElementById(id);
let last = null;
let clientIssue = null; // 'offline' when the Dell could not be reached or the answer came from cache

function e(tag, cls, text, style) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  if (style) for (const [k, v] of Object.entries(style)) n.style.setProperty(k, v);
  return n;
}
function logoEl(platform, size) {
  const w = e('span', 'plogo');
  w.innerHTML = platformLogo(platform, size);
  return w;
}
// One logo per platform, even if the list carries a platform twice.
function uniqConns(list) {
  const seen = new Set();
  const order = ['youtube', 'instagram', 'facebook', 'tiktok', 'bluesky'];
  const rank = (p) => (order.includes(p) ? order.indexOf(p) : 9);
  return (list || []).filter((c) => (seen.has(c.platform) ? false : (seen.add(c.platform), true))).sort((a, b) => rank(a.platform) - rank(b.platform));
}
function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) {
    const v = n / 1000;
    return (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}
function fmtDelta(p) {
  if (p === null || p === undefined) return '-';
  return (p > 0 ? '+' : '') + p + '%';
}
function fmtTime(iso, tz) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
function fmtDate(ymd) {
  return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function ago(min) {
  return min >= 60 ? Math.floor(min / 60) + 'h' : min + 'm';
}
function typeLabel(t) {
  return t === 'clip' ? 'Clip' : 'Episode';
}

function setChip(node, cls, text) {
  clear(node);
  node.className = 'chip glass ' + cls;
  node.appendChild(e('span', 'dot'));
  node.appendChild(document.createTextNode(text));
}

function renderStatus(s) {
  const chip = $('sync-chip');
  const banner = $('banner');
  banner.hidden = true;
  banner.className = 'banner';
  if (s.status.elo === 'ok') {
    setChip(chip, '', 'Synced ' + fmtTime(s.generatedAt, s.week.tz));
  } else if (s.status.elo === 'stale') {
    setChip(chip, 'amber', 'Last data ' + ago(s.status.staleMinutes) + ' ago, ELO unreachable');
  } else {
    setChip(chip, 'red', 'Token rejected');
  }
  let msg = null;
  let tone = 'amber';
  if (s.status.elo === 'unauthorized') {
    msg = 'ELO rejected the token. Showing the last good data. Make a new read-only bot token in ELO and update .env on the Dell.';
    tone = 'red';
  } else if (clientIssue === 'offline') {
    msg = 'Offline, showing last data from ' + fmtTime(s.generatedAt, s.week.tz) + '.';
  }
  if (msg) {
    banner.className = 'banner ' + tone;
    banner.textContent = msg;
    banner.hidden = false;
  }
}

function renderAttention(s) {
  const box = $('attention-box');
  const list = s.attentionSlots || [];
  box.hidden = !(list.length > 0 || s.totals.attention > 0);
  $('attention-title').textContent = (list.length || s.totals.attention) + ' need a look';
  const host = clear($('attention-list'));
  for (const a of list) {
    host.appendChild(e('div', 'att-row', `${a.brand}, ${typeLabel(a.type).toLowerCase()}, ${a.day} ${a.timeET} (${a.status})`));
  }
}

function renderTotals(s) {
  const host = clear($('totals'));
  const st = s.stats;
  const hours = st && st.watchHours !== undefined && st.watchHours !== null ? st.watchHours : null;
  const items = [
    ['Views', st ? fmtNum(st.views) : '-'],
    ['Likes', st ? fmtNum(st.likes) : '-'],
    ['Shares', st ? fmtNum(st.shares) : '-'],
    ['Comments', st ? fmtNum(st.comments) : '-'],
    ['Watch hours', hours === null ? '-' : hours >= 100 ? String(Math.round(hours)) : hours.toFixed(1)]
  ];
  for (const [label, v] of items) {
    const d = e('div', 'tot');
    d.appendChild(e('div', 'big', v));
    d.appendChild(e('div', 'cap', label));
    host.appendChild(d);
  }
}

function renderStrip(t, s) {
  const host = clear($('strip'));
  const stage = (key) => (t && t.stages.find((x) => x.key === key)) || { count: 0 };
  const flagged = stage('flagged').count + (s ? s.totals.attention : 0);
  const open = s ? (s.open3d !== undefined ? s.open3d : s.totals.open) : 0;
  const failed = t && t.badges ? t.badges.queue : 0;
  const nextPost = t && t.upcoming && t.upcoming.find((u) => u.whenUtc);
  const nextTime = nextPost ? new Date(nextPost.whenUtc).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '-';
  const nextDay = nextPost ? new Date(nextPost.whenUtc).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }) : '';
  const spend = t && t.spend ? '$' + t.spend.total.toFixed(2) : '-';
  const tiles = [
    ['Open slots, next 3 days', String(open), 'schedule', open > 0 ? 'amber' : '', ''],
    ['Scheduled', String(stage('scheduled').count), 'queue', '', ''],
    ['Posted this week', String(stage('posted').count), 'stats', '', ''],
    ['Needs a look', String(flagged), s && s.totals.attention > 0 ? 'queue' : 'flagged', flagged > 0 ? 'bad' : '', ''],
    ['Views, last 7 days', s && s.stats ? fmtNum(s.stats.views) : '-', 'stats', '', ''],
    [nextPost ? 'Next post, ' + nextDay : 'Next post', nextTime, 'queue', '', nextPost ? nextPost.brandName : ''],
    ['Failed or retrying', String(failed), 'queue', failed > 0 ? 'bad' : '', ''],
    ['AI spend this month', spend, 'spend', '', '']
  ];
  for (const [label, n, go, tone, tip] of tiles) {
    const b = e('button', 'glass tile-btn ' + tone);
    b.type = 'button';
    if (tip) b.title = tip;
    b.appendChild(e('div', 'big', n));
    b.appendChild(e('div', 'cap', label));
    b.addEventListener('click', () => onGo(go));
    host.appendChild(b);
  }
}

// Each channel's platforms added together, as Upload-Post reports them. Followers, views, likes, shares, watch time, impressions.
function renderAccounts(s) {
  const card = $('acct-card');
  const a = s.accounts;
  if (!a || !a.channels || a.channels.length === 0) { card.hidden = true; return; }
  card.hidden = false;
  const cols = [['followers', 'Followers'], ['views', 'Views'], ['likes', 'Likes'], ['shares', 'Shares'], ['watchHours', 'Watch hours'], ['impressions', 'Impressions']];
  const val = (v, k) => v === null || v === undefined ? '-' : (k === 'watchHours' ? String(Math.round(v * 10) / 10) : fmtNum(v));
  const tot = clear($('acct-total'));
  tot.className = 'totals5 acct-total';
  for (const [k, label] of cols) {
    const d = e('div');
    d.appendChild(e('div', 'big', val(a.total[k], k)));
    d.appendChild(e('div', 'cap', 'All channels: ' + label.toLowerCase()));
    tot.appendChild(d);
  }
  const grid = clear($('acct-grid'));
  for (const c of a.channels) {
    const row = e('div', 'acct-row');
    const who = e('div', 'acct-who');
    const dot = e('span', 'dot');
    dot.style.background = c.color;
    who.appendChild(dot);
    who.appendChild(e('span', 'nm', c.name));
    who.appendChild(e('span', 'fr', c.platforms.length + ' platform' + (c.platforms.length === 1 ? '' : 's')));
    row.appendChild(who);
    for (const [k, label] of cols) {
      const cell = e('div', 'acct-cell');
      cell.appendChild(e('div', 'v', val(c[k], k)));
      cell.appendChild(e('div', 'k', label));
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  $('acct-note').textContent = 'Numbers are what each platform reports through Upload-Post, added together. Some platforms report all time, others the last 28 or 30 days. Details by platform are on Analytics. ' + (a.updatedAt ? 'Read ' + new Date(a.updatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET.' : '');
}

let weekOffset = 0;
let weekData = null;
function renderBest2(s) {
  const host = clear($('best2'));
  for (const [label, v] of [['Best video, last 24 hrs', s.best24h], ['Best video, last 48 hrs', s.best48h]]) {
    const card = e('div', 'glass best-tile');
    card.appendChild(e('div', 'cap', label));
    if (!v) {
      card.appendChild(e('div', 'c', 'No posted video with numbers yet.'));
    } else {
      const body = e('div', 'best-body');
      const th = e('div', 'best-thumb');
      if (v.posterUrl) {
        const img = document.createElement('img');
        img.src = v.posterUrl;
        img.alt = '';
        img.addEventListener('error', () => img.remove());
        th.appendChild(img);
      }
      body.appendChild(th);
      const info = e('div', 'best-info');
      info.appendChild(e('div', 't', v.title));
      info.appendChild(e('div', 'c', v.channel));
      const views = e('div', 'v', fmtNum(v.views));
      views.appendChild(e('small', null, 'views'));
      info.appendChild(views);
      const chips = e('div', 'best-plat');
      for (const p of v.platforms || []) {
        const chip = e('span', 'bp-chip');
        chip.appendChild(logoEl(p.platform, 16));
        chip.appendChild(e('span', null, fmtNum(p.views)));
        chip.title = (PLAT_NAMES[p.platform] || p.platform) + ': ' + p.views + ' views, ' + p.likes + ' likes, ' + p.comments + ' comments, ' + p.shares + ' shares';
        chips.appendChild(chip);
      }
      info.appendChild(chips);
      body.appendChild(info);
      card.appendChild(body);
    }
    if (v) {
      card.classList.add('clickable');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', 'Show where the views come from');
      const open = () => showBestDetail(label, v);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    }
    host.appendChild(card);
  }
}
const PCOLOR = { youtube: '#ff4d4d', facebook: '#2f6bff', instagram: '#d946ef', tiktok: '#22d3ee', bluesky: '#8ec5ff' };
const PLAT_NAMES = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', bluesky: 'Bluesky' };
function showBestDetail(label, v) {
  const root = $('best2').parentNode;
  const old = root.querySelector('.best-pop');
  if (old) old.remove();
  const back = e('div', 'best-pop');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', (ev) => { if (ev.target === back) close(); });
  const box = e('div', 'glass best-pop-box');
  box.setAttribute('role', 'dialog');
  box.appendChild(e('div', 'cap', label));
  box.appendChild(e('div', 'pt', v.title));
  const when = v.postedAt ? ' · posted ' + new Date(v.postedAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
  box.appendChild(e('div', 'c', v.channel + when));
  const total = e('div', 'v', fmtNum(v.views));
  total.appendChild(e('small', null, 'views in total'));
  box.appendChild(total);
  const tbl = e('div', 'pp-table');
  const head = e('div', 'pp-row pp-head');
  for (const h of ['Platform', 'Views', 'Likes', 'Comments', 'Shares']) head.appendChild(e('div', null, h));
  tbl.appendChild(head);
  for (const p of (v.platforms || [])) {
    const row = e('div', 'pp-row');
    const pn = e('div', 'pn');
    pn.appendChild(logoEl(p.platform, 18));
    pn.appendChild(e('span', null, PLAT_NAMES[p.platform] || p.platform));
    row.appendChild(pn);
    row.appendChild(e('div', 'pv', fmtNum(p.views)));
    row.appendChild(e('div', null, fmtNum(p.likes)));
    row.appendChild(e('div', null, fmtNum(p.comments)));
    row.appendChild(e('div', null, fmtNum(p.shares)));
    tbl.appendChild(row);
  }
  if (!(v.platforms || []).length) tbl.appendChild(e('div', 'c', 'No per platform numbers yet.'));
  box.appendChild(tbl);
  box.appendChild(e('div', 'c', 'Numbers are the latest ELO has saved for each platform, read about once an hour. A platform that has not posted yet, or has no numbers, is not listed.'));
  const x = e('button', 'pp-close', 'Close');
  x.addEventListener('click', close);
  box.appendChild(x);
  back.appendChild(box);
  root.appendChild(back);
  x.focus();
}
function showWeek(s) {
  if (weekOffset === 0 || !weekData) { renderMap(s); return; }
  renderMap({ week: weekData.week, channels: weekData.channels });
}
async function goWeek(delta) {
  const next = Math.max(0, weekOffset + delta);
  if (next === weekOffset) return;
  weekOffset = next;
  weekData = null;
  if (weekOffset > 0 && loadWeek) {
    try { weekData = await loadWeek(weekOffset); } catch { weekData = null; }
    if (!weekData) weekOffset = 0;
  }
  if (last) showWeek(last);
}
function renderMap(s) {
  const host = clear($('week-map'));
  $('week-range').textContent = `${fmtDate(s.week.start)} to ${fmtDate(s.week.end)}` + (weekOffset === 0 ? ' (this week)' : '');
  $('week-prev').disabled = weekOffset === 0;
  const head = e('div', 'map-head');
  head.appendChild(e('div', 'dh chl', 'Channel'));
  s.week.days.forEach((date, i) => {
    head.appendChild(e('div', 'dh' + (date === s.week.today ? ' today' : ''), `${DAYS[i]} ${fmtDate(date)}`));
  });
  host.appendChild(head);
  for (const c of s.channels) {
    const row = e('div', 'map-row' + (c.state === 'active' ? '' : ' dim'));
    const who = e('div', 'who');
    who.appendChild(e('div', 'nm', c.name));
    who.title = c.state === 'active' ? c.filled + ' of ' + c.total + ' slots filled' : c.state;
    row.appendChild(who);
    c.days.forEach((day, i) => {
      const open = day.slots.filter((x) => x.state === 'open').length;
      const cell = e('div', 'cell' + (day.date === s.week.today ? ' today' : ''));
      cell.setAttribute('aria-label', `${c.name} ${DAYS[i]}: ${day.slots.length} slots, ${open} open`);
      if (day.slots.length === 0) cell.appendChild(e('span', 'none', '-'));
      for (const sl of day.slots) {
        if (sl.state === 'open') {
          const b = e('button', 'slot-open');
          b.type = 'button';
          b.appendChild(e('span', 'plus', '+ Fill Slot'));
          b.title = `${c.name}, ${typeLabel(sl.type)}, open${sl.timeET ? ' at ' + sl.timeET : ''}`;
          b.addEventListener('click', () => onGo('schedule'));
          cell.appendChild(b);
          continue;
        }
        const card = e('div', 'slot-card ' + sl.state);
        const th = e('div', 'slot-thumb', null, { background: `linear-gradient(135deg, ${c.color}, var(--violet))` });
        if (sl.posterUrl) {
          const img = document.createElement('img');
          img.src = sl.posterUrl;
          img.alt = '';
          img.addEventListener('error', () => img.remove());
          th.appendChild(img);
        }
        card.appendChild(th);
        const meta = e('div', 'slot-meta');
        if (sl.timeET) meta.appendChild(e('div', 'tm', sl.timeET));
        if (sl.platforms && sl.platforms.length) {
          const dots = e('div', 'pdots');
          for (const pf of sl.platforms) {
            const d = e('span', 'pdot' + (pf.status === 'failed' ? ' failed' : ''), null, { background: PCOLOR[pf.platform] || '#9ca3af' });
            d.title = (PLAT_NAMES[pf.platform] || pf.platform) + ': ' + pf.status.replace('_', ' ');
            dots.appendChild(d);
          }
          meta.appendChild(dots);
        } else {
          meta.appendChild(e('span', `slot ${sl.type} ${sl.state}`, null, { '--c': c.color }));
        }
        card.appendChild(meta);
        card.title = `${sl.title ? sl.title + ', ' : ''}${typeLabel(sl.type)}, ${sl.state === 'attention' ? 'needs attention' : 'filled'}`;
        cell.appendChild(card);
      }
      row.appendChild(cell);
    });
    host.appendChild(row);
  }
}

function renderCards(s) {
  const host = clear($('channel-cards'));
  for (const c of s.channels) {
    const active = c.state === 'active';
    const card = e('div', 'glass channel-card' + (active ? '' : ' dim'));
    const head = e('div', 'head');
    const title = e('div', 'title');
    title.appendChild(e('span', 'dot', null, { background: c.color, 'box-shadow': '0 0 10px ' + c.color }));
    title.appendChild(e('div', 'name', c.name));
    head.appendChild(title);
    head.appendChild(active ? e('div', 'pct', c.percent + '%') : e('div', 'state-label', c.state));
    card.appendChild(head);
    const hc = tiles && tiles.channels && tiles.channels.find((x) => x.brandId === c.id);
    if (hc && hc.connections && hc.connections.length) {
      const row = e('div', 'plogos');
      for (const cn of uniqConns(hc.connections)) { const l = logoEl(cn.platform, 22); l.classList.add('pl-' + cn.state); l.title = cn.label + ': ' + cn.note; row.appendChild(l); }
      card.appendChild(row);
    }
    const track = e('div', 'track');
    track.appendChild(e('div', 'fillbar', null, { width: (active ? c.percent : 0) + '%', background: `linear-gradient(90deg, ${c.color}, var(--open))` }));
    card.appendChild(track);
    const facts = e('div', 'facts');
    for (const [v, k] of [
      [active ? c.filled + '/' + c.total : '-', 'slots filled'],
      [fmtNum(c.views7d), 'views, 7d'],
      [fmtDelta(c.viewsDeltaPct), 'vs last wk']
    ]) {
      const f = e('div');
      f.appendChild(e('div', 'v', v));
      f.appendChild(e('div', 'k', k));
      facts.appendChild(f);
    }
    card.appendChild(facts);
    host.appendChild(card);
  }
}

function renderVideos(s) {
  const host = clear($('top-videos'));
  if (s.topVideos.length === 0) {
    host.appendChild(e('div', 'none-msg', 'No posted videos in the last 7 days.'));
    return;
  }
  const colors = new Map(s.channels.map((c) => [c.name, c.color]));
  for (const v of s.topVideos.slice(0, 3)) {
    const card = e('button', 'short-card');
    card.type = 'button';
    const th = e('div', 'short-thumb', null, { background: `linear-gradient(135deg, ${colors.get(v.channel) || 'var(--cyan)'}, var(--violet))` });
    if (v.posterUrl) {
      const img = document.createElement('img');
      img.src = v.posterUrl;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
      th.appendChild(img);
    }
    th.appendChild(e('span', 'ratio', '9:16'));
    card.appendChild(th);
    card.appendChild(e('div', 'short-title', v.title));
    card.appendChild(e('div', 'short-chan', v.channel));
    const views = e('div', 'short-views', (v.approximate ? '~' : '') + fmtNum(v.views));
    views.appendChild(e('small', null, ' views'));
    card.appendChild(views);
    card.addEventListener('click', () => showBestDetail('Top performing, last 7 days', v));
    host.appendChild(card);
  }
}

function renderRunway(s) {
  const host = clear($('runway'));
  const list = ((tiles && tiles.channels) || []).slice();
  if (!list.length) { host.appendChild(e('div', 'none-msg', 'No channel health yet.')); return; }
  const et = (iso, opts) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, opts));
  // Most urgent first: needs the owner, then the soonest hole.
  const urgency = (c) => {
    const st = c.status || {};
    const hole = st.firstHoleUtc ? Date.parse(st.firstHoleUtc) : Infinity;
    return [st.attention > 0 ? 0 : 1, hole];
  };
  list.sort((a, b) => { const x = urgency(a), y = urgency(b); return x[0] - y[0] || x[1] - y[1]; });
  for (const c of list) {
    const st = c.status || { next: null, coveredDays: null, firstHoleUtc: null, holeSoon: false, attention: 0, platformResults: [] };
    const card = e('div', 'ch-card');
    const top = e('div', 'ch-top');
    top.appendChild(e('div', 'rn', c.name));
    const logos = e('div', 'plogos tight');
    const byPlat = new Map((st.platformResults || []).map((r) => [r.platform, r.result]));
    for (const cn of uniqConns(c.connections)) {
      const l = logoEl(cn.platform, 20);
      const res = byPlat.get(cn.platform);
      const cls = cn.state === 'bad' ? 'bad' : res === 'failed' ? 'bad' : res === 'pending' ? 'warn' : res === 'ok' ? 'ok' : cn.state;
      l.classList.add('pl-' + cls);
      l.title = cn.label + ': ' + (res === 'ok' ? 'last post went out' : res === 'failed' ? 'last post failed or needs you' : res === 'pending' ? 'a retry is pending' : cn.note);
      logos.appendChild(l);
    }
    top.appendChild(logos);
    card.appendChild(top);
    const row = (label, text, cls) => {
      const r = e('div', 'ch-line');
      r.appendChild(e('span', 'ch-k', label));
      r.appendChild(e('span', 'ch-v' + (cls ? ' ' + cls : ''), text));
      return r;
    };
    if (c.paused) card.appendChild(row('Status', 'Paused', 'amber'));
    // 1. Next post.
    const nx = st.next;
    const nxRow = row('Next', nx ? '"' + nx.title.replace(/\s*\|.*$/, '') + '", ' + et(nx.whenUtc, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Nothing scheduled', nx ? '' : 'amber');
    if (nx) nxRow.title = nx.title;
    card.appendChild(nxRow);
    // 2. Coverage and the first hole.
    if (st.coveredDays !== null && st.coveredDays !== undefined) {
      const hole = st.firstHoleUtc ? et(st.firstHoleUtc, { weekday: 'short', month: 'short', day: 'numeric' }) : null;
      const txt = hole
        ? 'Covered ' + st.coveredDays + (st.coveredDays === 1 ? ' day' : ' days') + ', first hole ' + hole
        : 'Covered 30+ days, no holes';
      card.appendChild(row('Coverage', txt, st.holeSoon ? 'bad' : ''));
    }
    // 3. Attention.
    const at = row('Attention', st.attention > 0 ? st.attention + (st.attention === 1 ? ' needs you' : ' need you') : 'All clear', st.attention > 0 ? 'bad' : 'ok');
    if (st.attention > 0) {
      at.classList.add('link');
      at.title = 'Open the Queue to see them';
      at.addEventListener('click', () => onGo('queue'));
    }
    card.appendChild(at);
    host.appendChild(card);
  }
}

let tiles = null;
function renderSnapshot(s) {
  last = s;
  root.host.classList.remove('loading');
  $('week-chip').textContent = `${DAYS[0]} ${fmtDate(s.week.start)} to ${DAYS[6]} ${fmtDate(s.week.end)} · ET`;
  renderStatus(s);
  $('empty-state').hidden = !s.totals.empty;
  renderAttention(s);
  renderStrip(tiles, s);
  renderTotals(s);
  renderBest2(s);
  renderAccounts(s);
  if (weekOffset > 0 && loadWeek) {
    loadWeek(weekOffset).then((w) => { weekData = w; showWeek(s); }).catch(() => showWeek(s));
  } else showWeek(s);
  renderCards(s);
  renderVideos(s);
  renderRunway(s);
  $('foot').textContent = 'Data from ELO · updated ' + fmtTime(s.generatedAt, s.week.tz);
}

function renderStartup(info) {
  const banner = $('banner');
  banner.hidden = true;
  if (info.issue === 'unauthorized') {
    setChip($('sync-chip'), 'red', 'Token rejected');
    banner.className = 'banner red';
    banner.textContent = 'ELO rejected the token, so there is no data yet. Make a new read-only bot token in ELO and update .env on the Dell.';
    banner.hidden = false;
  } else if (info.issue === 'unreachable') {
    setChip($('sync-chip'), 'amber', 'ELO unreachable, no data yet');
  } else {
    setChip($('sync-chip'), 'amber', 'Starting up, waiting for first data');
  }
}


let timer = null;
async function load(force) {
  try {
    try { tiles = await loadTiles(); } catch { /* keep the last tiles */ }
    const s = await loadSnapshot(force);
    if (!s) {
      if (!last) setChip($('sync-chip'), 'amber', 'Starting up, waiting for first data');
      return;
    }
    clientIssue = null;
    renderSnapshot(s);
  } catch {
    clientIssue = 'offline';
    if (last) renderSnapshot(last);
    else setChip($('sync-chip'), 'red', 'No data yet');
  }
}
$('week-prev').addEventListener('click', () => goWeek(-1));
$('week-next').addEventListener('click', () => goWeek(1));
$('refresh').addEventListener('click', () => load(true));
timer = setInterval(() => load(), 60000);
load();
return () => clearInterval(timer);
}
