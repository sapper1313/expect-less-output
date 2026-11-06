import { etToUtc } from '../../src/main/dashboard/week';

const TZ = 'America/New_York';
export const FIXTURE_NOW = new Date('2026-10-26T17:02:00Z');
export const DAYS = [
  '2026-10-25',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31'
];

interface Chan {
  id: number;
  name: string;
  epTime: string;
  clipTime?: string;
  /** index 0..6 = Sun..Sat. 'E' filled episode, 'e' open episode, 'C' filled clip, 'c' open clip, '-' no slot. */
  codes: string[];
  postDays: number[] | null;
  clipDays: number[];
  views7d: number;
  likes: number;
  comments: number;
  shares: number;
}

const ALL = [1, 2, 3, 4, 5, 6, 7];
export const CHANNELS: Chan[] = [
  { id: 1, name: 'Trash Panda', epTime: '11:00', codes: ['E','E','E','E','E','E','e'], postDays: null, clipDays: [], views7d: 148000, likes: 9000, comments: 1000, shares: 1800 },
  { id: 2, name: 'Clock Out Early', epTime: '15:00', clipTime: '09:00', codes: ['EC','EC','EC','EC','EC','Ec','Ec'], postDays: null, clipDays: ALL, views7d: 121000, likes: 8000, comments: 800, shares: 1500 },
  { id: 3, name: 'Teach Your Parents Tech', epTime: '18:00', codes: ['E','E','E','E','E','E','E'], postDays: null, clipDays: [], views7d: 64000, likes: 5000, comments: 600, shares: 1100 },
  { id: 4, name: 'The Math of It', epTime: '12:00', codes: ['E','E','E','E','e','E','e'], postDays: null, clipDays: [], views7d: 41000, likes: 3000, comments: 400, shares: 700 },
  { id: 5, name: 'Wonder Hollow', epTime: '16:00', codes: ['-','E','-','E','-','E','-'], postDays: [1, 3, 5], clipDays: [], views7d: 22000, likes: 2000, comments: 200, shares: 300 },
  { id: 6, name: 'Mia & Chloe', epTime: '10:00', codes: ['-','-','E','-','e','-','e'], postDays: [2, 4, 6], clipDays: [], views7d: 16000, likes: 1400, comments: 100, shares: 200 }
];

export const OPEN_EPISODE_INSTANTS: Record<number, string[]> = {
  1: ['2026-10-31T15:00:00.000Z'],
  2: [],
  3: [],
  4: ['2026-10-29T16:00:00.000Z', '2026-10-31T16:00:00.000Z'],
  5: [],
  6: ['2026-10-29T14:00:00.000Z', '2026-10-31T14:00:00.000Z']
};

/** Views for the older posted videos that make up "top videos". */
export const POST_VIEWS: Record<number, number> = {
  1001: 48200,
  1002: 39700,
  1003: 27100,
  1004: 15400,
  1005: 9800
};

function rawBrand(c: Chan) {
  return {
    id: c.id,
    name: c.name,
    slug: c.name.toLowerCase().replace(/[^a-z]+/g, '-'),
    state: 'active',
    archived: false,
    paused: false,
    on_hold: false,
    post_days: c.postDays,
    daily_cap: 1,
    slots: [
      { day_type: 'weekday', time_local: c.epTime, enabled: true },
      { day_type: 'weekend', time_local: c.epTime, enabled: true }
    ],
    clip_post_days: c.clipDays,
    clip_time: c.clipTime ?? null,
    clip_platforms: [],
    blackout_dates: []
  };
}

function rawPost(id: number, brandId: number, type: 'episode' | 'clip', date: string, time: string, status: string, title: string) {
  return {
    id,
    brand_id: brandId,
    title,
    status,
    post_type: type,
    scheduled_at: etToUtc(date, time, TZ)
  };
}

export function makeFixtures(): { brands: unknown[]; posts: unknown[] } {
  const brands: unknown[] = CHANNELS.map(rawBrand);
  brands.push({
    ...rawBrand({ id: 99, name: 'Backup Heroes', epTime: '08:00', codes: [], postDays: null, clipDays: [], views7d: 0, likes: 0, comments: 0, shares: 0 }),
    state: 'archived',
    archived: true
  });
  const posts: unknown[] = [];
  let nextId = 100;
  for (const c of CHANNELS) {
    c.codes.forEach((code, i) => {
      const date = DAYS[i];
      for (const k of code) {
        if (k === 'E' || k === 'C') {
          const type = k === 'E' ? 'episode' : 'clip';
          const time = k === 'E' ? c.epTime : (c.clipTime as string);
          const iso = etToUtc(date, time, TZ);
          const past = Date.parse(iso) < FIXTURE_NOW.getTime();
          posts.push(
            rawPost(nextId++, c.id, type, date, time, past ? 'posted' : 'scheduled', `${c.name} ${date} ${type}`)
          );
        }
      }
    });
  }
  const older: [number, number, string, string][] = [
    [1001, 1, 'Raccoon vs. the Trash Can Fort', '2026-10-24'],
    [1002, 2, 'Stop Doing This in Excel', '2026-10-24'],
    [1003, 3, 'How to Spot a Fake Text', '2026-10-24'],
    [1004, 4, 'Why 0.999... Equals 1', '2026-10-24'],
    [1005, 5, 'The Moonlit Pond', '2026-10-23']
  ];
  for (const [id, brandId, title, date] of older) {
    const ch = CHANNELS.find((c) => c.id === brandId) as Chan;
    posts.push(rawPost(id, brandId, 'episode', date, ch.epTime, 'posted', title));
  }
  return { brands, posts };
}
