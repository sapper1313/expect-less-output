/* eslint-disable */
// @ts-nocheck
// The As Expected. dashboard page logic, run inside a shadow root so its styles stay apart from ELO's.
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
  const tiles = [
    ['Being written', stage('writing').count, 'inbox', ''],
    ['Ready for video', stage('ready').count, 'inbox', ''],
    ['Video in progress', stage('making').count, 'inbox', ''],
    ['Open slots, next 3 days', open, 'schedule', open > 0 ? 'amber' : ''],
    ['Scheduled', stage('scheduled').count, 'queue', ''],
    ['Posted this week', stage('posted').count, 'stats', ''],
    ['Needs a look', flagged, s && s.totals.attention > 0 ? 'queue' : 'flagged', flagged > 0 ? 'bad' : '']
  ];
  for (const [label, n, go, tone] of tiles) {
    const b = e('button', 'glass tile-btn ' + tone);
    b.type = 'button';
    b.appendChild(e('div', 'big', String(n)));
    b.appendChild(e('div', 'cap', label));
    b.addEventListener('click', () => onGo(go));
    host.appendChild(b);
  }
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
      card.appendChild(e('div', 't', v.title));
      card.appendChild(e('div', 'c', v.channel));
      const views = e('div', 'v', fmtNum(v.views));
      views.appendChild(e('small', null, 'views'));
      card.appendChild(views);
    }
    host.appendChild(card);
  }
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
  head.appendChild(e('div'));
  s.week.days.forEach((date, i) => {
    const d = e('div', 'dh' + (date === s.week.today ? ' today' : ''));
    d.appendChild(e('div', 'dn', DAYS[i]));
    d.appendChild(e('div', 'dd', fmtDate(date)));
    head.appendChild(d);
  });
  host.appendChild(head);
  for (const c of s.channels) {
    const row = e('div', 'map-row' + (c.state === 'active' ? '' : ' dim'));
    const who = e('div', 'who');
    who.appendChild(e('span', 'bar', null, { background: c.color, 'box-shadow': '0 0 10px ' + c.color }));
    const nm = e('div');
    nm.appendChild(e('div', 'nm', c.name));
    nm.appendChild(e('div', 'fr', c.state === 'active' ? c.filled + '/' + c.total : c.state));
    who.appendChild(nm);
    row.appendChild(who);
    c.days.forEach((day, i) => {
      const open = day.slots.filter((x) => x.state === 'open').length;
      const cell = e('div', 'cell' + (day.date === s.week.today ? ' today' : ''));
      cell.setAttribute('aria-label', `${c.name} ${DAYS[i]}: ${day.slots.length} slots, ${open} open`);
      if (day.slots.length === 0) cell.appendChild(e('span', 'none', '-'));
      for (const sl of day.slots) {
        const dot = e('span', `slot ${sl.type} ${sl.state}`, null, { '--c': c.color });
        dot.title = `${typeLabel(sl.type)}, ${sl.state}`;
        cell.appendChild(dot);
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
    const track = e('div', 'track');
    track.appendChild(e('div', 'fillbar', null, { width: (active ? c.percent : 0) + '%', background: `linear-gradient(90deg, ${c.color}, #ff3df2)` }));
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
  const rankColor = ['#ffcf7a', '#d7defa', '#ffa56b'];
  for (const v of s.topVideos.slice(0, 3)) {
    const row = e('div', 'video-row');
    row.appendChild(e('div', 'rank', String(v.rank), { color: rankColor[v.rank - 1] || '#9ca7da' }));
    const base = colors.get(v.channel) || '#22e5ff';
    row.appendChild(e('div', 'thumb', null, { background: `linear-gradient(135deg, ${base}, #8a5cff)` }));
    const info = e('div', 'info');
    info.appendChild(e('div', 't', v.title));
    info.appendChild(e('div', 'c', v.channel));
    row.appendChild(info);
    const views = e('div', 'views', (v.approximate ? '~' : '') + fmtNum(v.views));
    views.appendChild(e('small', null, 'views'));
    row.appendChild(views);
    host.appendChild(row);
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
  if (weekOffset > 0 && loadWeek) {
    loadWeek(weekOffset).then((w) => { weekData = w; showWeek(s); }).catch(() => showWeek(s));
  } else showWeek(s);
  renderCards(s);
  renderVideos(s);
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
