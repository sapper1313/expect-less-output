import { describe, it, expect } from 'vitest';
import { buildSnapshot, slotsAgree, type SnapshotInput } from '../../src/main/dashboard/snapshot';
import { normalizeBrand, normalizePost } from '../../src/main/dashboard/eloClient';
import { makeFixtures, FIXTURE_NOW, CHANNELS } from './fixtures';

function input(over: Partial<SnapshotInput> = {}): SnapshotInput {
  const fx = makeFixtures();
  return {
    now: FIXTURE_NOW,
    tz: 'America/New_York',
    brands: fx.brands.map(normalizeBrand),
    posts: fx.posts.map(normalizePost),
    brandStats: new Map(
      CHANNELS.map((c) => [c.id, { views: c.views7d, likes: c.likes, comments: c.comments, shares: c.shares, approximate: false }])
    ),
    topVideos: [],
    trend: [],
    viewsDelta: new Map(),
    nextOpenByBrand: null,
    elo: { status: 'ok', lastGoodAt: FIXTURE_NOW.toISOString() },
    ...over
  };
}

describe('buildSnapshot', () => {
  it('reproduces the approved mockup numbers: 41 slots, 34 filled, 7 open, 83%', () => {
    const s = buildSnapshot(input());
    expect(s.totals).toEqual({ slots: 41, filled: 34, open: 7, attention: 0, percent: 83, empty: false });
    expect(s.week).toMatchObject({ start: '2026-10-25', end: '2026-10-31', today: '2026-10-26' });
  });
  it('lists open slots in date then time order', () => {
    const s = buildSnapshot(input());
    expect(s.openSlots.map((o) => `${o.brand}|${o.type}|${o.day}|${o.timeET}`)).toEqual([
      'Mia & Chloe|episode|Thu|10:00 AM',
      'The Math of It|episode|Thu|12:00 PM',
      'Clock Out Early|clip|Fri|9:00 AM',
      'Clock Out Early|clip|Sat|9:00 AM',
      'Mia & Chloe|episode|Sat|10:00 AM',
      'Trash Panda|episode|Sat|11:00 AM',
      'The Math of It|episode|Sat|12:00 PM'
    ]);
  });
  it('omits archived brands and dims paused ones without counting them', () => {
    const base = input();
    const brands = base.brands.map((b) => (b.id === 6 ? { ...b, state: 'paused' as const } : b));
    const s = buildSnapshot({ ...base, brands });
    expect(s.channels.find((c) => c.id === 99)).toBeUndefined();
    const paused = s.channels.find((c) => c.id === 6);
    expect(paused).toMatchObject({ state: 'paused', total: 0, filled: 0, percent: 0 });
    expect(s.totals.slots).toBe(38);
  });
  it('builds per-channel day cells and numbers', () => {
    const s = buildSnapshot(input());
    const coe = s.channels.find((c) => c.id === 2)!;
    expect(coe).toMatchObject({ name: 'Clock Out Early', filled: 12, total: 14, percent: 86, views7d: 121000 });
    expect(coe.days).toHaveLength(7);
    expect(coe.days[5].slots).toEqual([
      { type: 'episode', state: 'filled' },
      { type: 'clip', state: 'open' }
    ]);
    const wh = s.channels.find((c) => c.id === 5)!;
    expect(wh.days[0].slots).toEqual([]);
  });
  it('sums stats across counted channels', () => {
    expect(buildSnapshot(input()).stats).toEqual({ views: 412000, likes: 28400, comments: 3100, shares: 5600 });
  });
  it('lists up next for 48 hours, filled slots only', () => {
    const s = buildSnapshot(input());
    expect(s.upNext.map((u) => `${u.whenET}|${u.channel}|${u.type}`)).toEqual([
      'Today 3:00 PM|Clock Out Early|episode',
      'Today 4:00 PM|Wonder Hollow|episode',
      'Today 6:00 PM|Teach Your Parents Tech|episode',
      'Tue 9:00 AM|Clock Out Early|clip',
      'Tue 10:00 AM|Mia & Chloe|episode',
      'Tue 11:00 AM|Trash Panda|episode'
    ]);
  });
  it('reports empty with 0 percent when no brand is active', () => {
    const base = input();
    const s = buildSnapshot({ ...base, brands: base.brands.map((b) => ({ ...b, state: 'paused' as const })) });
    expect(s.totals).toMatchObject({ slots: 0, percent: 0, empty: true });
    expect(JSON.stringify(s)).not.toContain('NaN');
    expect(s.stats).toEqual({ views: 0, likes: 0, comments: 0, shares: 0 });
  });
  it('hides the trend until two entries exist and always nulls revenue', () => {
    expect(buildSnapshot(input({ trend: [{ week: 'a', percent: 1 }] })).trend).toEqual([]);
    const two = [{ week: 'a', percent: 1 }, { week: 'b', percent: 2 }];
    const s = buildSnapshot(input({ trend: two }));
    expect(s.trend).toEqual(two);
    expect(s.revenue).toBeNull();
  });
  it('flags attention slots and keeps them filled', () => {
    const base = input();
    const posts = base.posts.map((p, i) => (i === 0 ? { ...p, status: 'failed' } : p));
    const s = buildSnapshot({ ...base, posts });
    expect(s.totals.attention).toBe(1);
    expect(s.totals.filled).toBe(34);
    expect(s.attentionSlots).toHaveLength(1);
    expect(s.attentionSlots[0].status).toBe('failed');
  });
  it('sets checks.slotsAgree from ELO next-open data', () => {
    const agree = new Map([
      [1, ['2026-10-31T15:00:00.000Z']],
      [4, ['2026-10-29T16:00:00.000Z', '2026-10-31T16:00:00.000Z']],
      [6, ['2026-10-29T14:00:00.000Z', '2026-10-31T14:00:00.000Z']]
    ]);
    expect(buildSnapshot(input({ nextOpenByBrand: agree })).checks.slotsAgree).toBe(true);
    const off = new Map(agree);
    off.set(1, []);
    expect(buildSnapshot(input({ nextOpenByBrand: off })).checks.slotsAgree).toBe(false);
  });
  it('never contains bearer or token text', () => {
    expect(JSON.stringify(buildSnapshot(input()))).not.toMatch(/Bearer|token/i);
  });
});

describe('up next across the week boundary', () => {
  it('shows Sunday posts on Saturday evening', () => {
    const base = input({ now: new Date('2026-10-31T23:00:00Z') });
    const sunday = normalizePost({
      id: 5000, brand_id: 1, title: 'x', status: 'scheduled', post_type: 'episode',
      scheduled_at_utc: '2026-11-01T16:00:00Z'
    });
    const s = buildSnapshot({ ...base, posts: [...base.posts, sunday] });
    expect(s.upNext).toEqual([{ whenET: 'Sun 11:00 AM', channel: 'Trash Panda', type: 'episode' }]);
    expect(s.totals.slots).toBe(41);
  });
});

describe('real-world brand: cap 1, three slot times, post days Wed and Fri', () => {
  const trash = normalizeBrand({
    state: 'active', on_hold: false, post_days: [3, 5], clip_post_days: [], clip_time: '12:00', daily_cap: 1,
    blackout_dates: [], id: 1, name: 'Trash Panda', archived: false, paused: false,
    slots: [
      { day_type: 'weekend', time_local: '10:00', enabled: true }, { day_type: 'weekend', time_local: '18:00', enabled: true },
      { day_type: 'weekday', time_local: '10:00', enabled: true }, { day_type: 'weekday', time_local: '15:00', enabled: true },
      { day_type: 'weekday', time_local: '20:00', enabled: true }
    ]
  });
  const mk = (id: number, at: string, status: string) =>
    normalizePost({ id, brand_id: 1, title: 'x', status, post_type: 'episode', scheduled_at: at });
  const base = () => ({ ...input(), brands: [trash], posts: [], brandStats: new Map() });

  it('expects 2 slots a week, both open when nothing is scheduled', () => {
    const s = buildSnapshot(base());
    expect(s.totals).toMatchObject({ slots: 2, filled: 0, open: 2, percent: 0 });
    expect(s.openSlots.map((o) => `${o.day} ${o.timeET}`)).toEqual(['Wed 10:00 AM', 'Fri 10:00 AM']);
  });
  it('a post at 3 PM Wednesday fills Wednesday', () => {
    const s = buildSnapshot({ ...base(), posts: [mk(1, '2026-10-28T19:00:00Z', 'scheduled')] });
    expect(s.totals).toMatchObject({ slots: 2, filled: 1, open: 1, percent: 50 });
  });
  it('a failed Wednesday post is attention, and the self-check expects ELO to still offer that day', () => {
    const nextOpen = new Map([[1, ['2026-10-28T14:00:00.000Z', '2026-10-30T14:00:00.000Z']]]);
    const s = buildSnapshot({ ...base(), posts: [mk(1, '2026-10-28T14:00:00Z', 'failed')], nextOpenByBrand: nextOpen });
    expect(s.totals).toMatchObject({ slots: 2, filled: 1, attention: 1, open: 1 });
    expect(s.checks.slotsAgree).toBe(true);
  });
});

describe('self-check detail', () => {
  it('lists, per channel, the slots only we think are open and the ones only ELO offers, in Eastern time', () => {
    const agree = new Map([
      [1, ['2026-10-31T15:00:00.000Z']],
      [4, ['2026-10-29T16:00:00.000Z', '2026-10-31T16:00:00.000Z']],
      [6, ['2026-10-29T14:00:00.000Z', '2026-10-31T14:00:00.000Z']]
    ]);
    expect(buildSnapshot(input({ nextOpenByBrand: agree })).checks.diffs).toEqual([]);
    const off = new Map(agree);
    off.set(1, ['2026-10-30T15:00:00.000Z']);
    const s = buildSnapshot(input({ nextOpenByBrand: off }));
    expect(s.checks.slotsAgree).toBe(false);
    expect(s.checks.diffs).toEqual([
      { brand: 'Trash Panda', onlyMine: ['Sat Oct 31 11:00 AM'], onlyElo: ['Fri Oct 30 11:00 AM'] }
    ]);
  });
});

describe('self-check and ELO minimum gap', () => {
  const agreeBase = new Map([
    [1, ['2026-10-31T15:00:00.000Z']],
    [4, ['2026-10-31T16:00:00.000Z']], // ELO hides Math of It Thu 12:00 ET (2026-10-29T16:00Z)
    [6, ['2026-10-29T14:00:00.000Z', '2026-10-31T14:00:00.000Z']]
  ]);
  const withPost = (status: string, brandId = 1) => {
    const base = input({ nextOpenByBrand: agreeBase });
    const other = normalizePost({ id: 9000, brand_id: brandId, title: 'x', status, post_type: 'clip', scheduled_at: '2026-10-29T16:00:00Z' });
    return { ...base, posts: [...base.posts, other] };
  };
  it('does not flag a slot ELO hides because another channel has a reserved post in the same minute', () => {
    const s = buildSnapshot({ ...withPost('scheduled'), minGapMinutes: 1 });
    expect(s.checks.slotsAgree).toBe(true);
    expect(s.openSlots.some((o) => o.brand === 'The Math of It' && o.day === 'Thu')).toBe(true);
  });
  it('still flags it when the other post is already posted (ELO would not hide it)', () => {
    expect(buildSnapshot({ ...withPost('posted'), minGapMinutes: 1 }).checks.slotsAgree).toBe(false);
  });
  it('still flags it when the colliding post is on the same channel, or the gap is 0', () => {
    expect(buildSnapshot({ ...withPost('scheduled', 4), minGapMinutes: 1 }).checks.slotsAgree).toBe(false);
    expect(buildSnapshot({ ...withPost('scheduled'), minGapMinutes: 0 }).checks.slotsAgree).toBe(false);
  });
});

describe('slotsAgree', () => {
  it('compares sets within the window', () => {
    expect(slotsAgree(['a', 'b'], ['b', 'a'], '', '~')).toBe(true);
    expect(slotsAgree(['a'], ['a', 'b'], '', '~')).toBe(false);
    expect(slotsAgree(['2026-10-31T10:00:00.000Z'], ['2026-10-31T10:00:00.000Z', '2026-12-01T10:00:00.000Z'], '2026-10-26T00:00:00.000Z', '2026-11-01T04:00:00.000Z')).toBe(true);
  });
});
