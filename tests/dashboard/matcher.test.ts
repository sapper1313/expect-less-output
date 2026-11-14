import { describe, it, expect } from 'vitest';
import { matchSlots, summarize } from '../../src/main/dashboard/matcher';
import type { Post, Slot } from '../../src/main/dashboard/types';

function slot(over: Partial<Slot> = {}): Slot {
  return {
    brandId: 1,
    type: 'episode',
    instant: '2026-10-31T14:00:00.000Z',
    date: '2026-10-31',
    weekday: 6,
    timeET: '10:00 AM',
    ...over
  };
}
function post(over: Partial<Post> = {}): Post {
  return {
    id: 1,
    brandId: 1,
    type: 'episode',
    status: 'scheduled',
    scheduledAtUtc: '2026-10-31T14:00:00Z',
    postedAtUtc: null,
    title: 't',
    ...over
  };
}

describe('matchSlots near a slot', () => {
  it('a post 30 minutes off the slot still fills it (its earliest platform time)', () => {
    const [m] = matchSlots([slot()], [post({ scheduledAtUtc: '2026-10-31T13:30:00Z' })]);
    expect(m.state).toBe('filled');
  });
  it('one post fills only one slot, and a post far from any slot fills none', () => {
    const slots = [slot(), slot({ instant: '2026-10-31T14:30:00.000Z' })];
    const r = matchSlots(slots, [post({ scheduledAtUtc: '2026-10-31T14:10:00Z' })]);
    expect(r.filter((x) => x.state === 'filled')).toHaveLength(1);
    expect(matchSlots([slot()], [post({ scheduledAtUtc: '2026-10-31T20:00:00Z' })])[0].state).toBe('open');
  });
});

describe('matchSlots', () => {
  it('fills a slot when the post is the same minute in a different format', () => {
    const [m] = matchSlots([slot()], [post()]);
    expect(m.state).toBe('filled');
    expect(m.postId).toBe(1);
  });
  it('matches a post that has seconds', () => {
    const [m] = matchSlots([slot()], [post({ scheduledAtUtc: '2026-10-31T14:00:42.000Z' })]);
    expect(m.state).toBe('filled');
  });
  it('does not mix clips and episodes', () => {
    expect(matchSlots([slot()], [post({ type: 'clip' })])[0].state).toBe('open');
    expect(matchSlots([slot({ type: 'clip' })], [post()])[0].state).toBe('open');
  });
  it('does not match a post from another brand', () => {
    expect(matchSlots([slot()], [post({ brandId: 2 })])[0].state).toBe('open');
  });
  it('maps statuses', () => {
    const states = (status: string) => matchSlots([slot()], [post({ status })])[0].state;
    expect(states('canceled')).toBe('open');
    expect(states('draft')).toBe('open');
    expect(states('scheduled')).toBe('filled');
    expect(states('in_progress')).toBe('filled');
    expect(states('partial')).toBe('filled');
    expect(states('posted')).toBe('filled');
    expect(states('failed')).toBe('attention');
    expect(states('missed')).toBe('attention');
  });
  it('counts a slot once when two posts land in it, preferring filled over attention', () => {
    const m = matchSlots(
      [slot()],
      [post({ id: 1, status: 'failed' }), post({ id: 2, status: 'scheduled' })]
    );
    expect(m).toHaveLength(1);
    expect(m[0].state).toBe('filled');
    expect(m[0].postId).toBe(2);
  });
  it('ignores posts that match no slot', () => {
    const m = matchSlots([slot()], [post({ scheduledAtUtc: '2026-10-31T16:00:00Z' })]);
    expect(m[0].state).toBe('open');
  });
});

describe('summarize', () => {
  it('computes 83 percent for 34 of 41', () => {
    const matched = Array.from({ length: 41 }, (_, i) => ({
      ...slot({ instant: `i${i}` }),
      state: i < 34 ? ('filled' as const) : ('open' as const),
      postId: null
    }));
    const t = summarize(matched);
    expect(t).toEqual({ slots: 41, filled: 34, open: 7, attention: 0, percent: 83, empty: false });
  });
  it('returns zeros and empty for no slots, never NaN', () => {
    expect(summarize([])).toEqual({
      slots: 0,
      filled: 0,
      open: 0,
      attention: 0,
      percent: 0,
      empty: true
    });
  });
  it('includes attention slots in filled', () => {
    const t = summarize([
      { ...slot(), state: 'attention', postId: 1 },
      { ...slot({ instant: 'b' }), state: 'open', postId: null }
    ]);
    expect(t.filled).toBe(1);
    expect(t.attention).toBe(1);
    expect(t.open).toBe(1);
    expect(t.percent).toBe(50);
  });
});

describe('day-level matching (daily cap and clips)', () => {
  const tz = 'America/New_York';
  const wed = (over: Partial<Slot> = {}) => slot({ instant: '2026-10-28T14:00:00.000Z', date: '2026-10-28', weekday: 3, timeET: '10:00 AM', ...over });
  const wedPost = (over: Partial<Post> = {}) => post({ scheduledAtUtc: '2026-10-28T19:00:00Z', ...over });
  const opts = { tz, dailyCapByBrand: new Map([[1, 1]]) };

  it('a post at any time on the date fills the one capped slot', () => {
    expect(matchSlots([wed()], [wedPost()], opts)[0].state).toBe('filled');
  });
  it('uses the Eastern date, not the UTC date, for a late-evening post', () => {
    const late = wedPost({ scheduledAtUtc: '2026-10-29T02:00:00Z' });
    expect(matchSlots([wed()], [late], opts)[0].state).toBe('filled');
    const nextDay = wedPost({ scheduledAtUtc: '2026-10-29T14:00:00Z' });
    expect(matchSlots([wed()], [nextDay], opts)[0].state).toBe('open');
  });
  it('a failed post alone is attention, and a good post beats it', () => {
    expect(matchSlots([wed()], [wedPost({ status: 'failed' })], opts)[0].state).toBe('attention');
    expect(matchSlots([wed()], [wedPost({ id: 1, status: 'failed' }), wedPost({ id: 2 })], opts)[0].state).toBe('filled');
  });
  it('canceled and draft posts leave the capped slot open', () => {
    expect(matchSlots([wed()], [wedPost({ status: 'canceled' }), wedPost({ id: 2, status: 'draft' })], opts)[0].state).toBe('open');
  });
  it('with a cap of 2 an exact-minute post claims its own slot and the other stays open', () => {
    const slots = [wed(), wed({ instant: '2026-10-28T19:00:00.000Z', timeET: '3:00 PM' })];
    const m = matchSlots(slots, [wedPost()], { tz, dailyCapByBrand: new Map([[1, 2]]) });
    expect(m.map((x) => x.state)).toEqual(['open', 'filled']);
  });
  it('extra posts beyond the cap do not create extra filled slots', () => {
    const m = matchSlots([wed()], [wedPost({ id: 1 }), wedPost({ id: 2, scheduledAtUtc: '2026-10-28T22:00:00Z' })], opts);
    expect(m).toHaveLength(1);
    expect(summarize(m).filled).toBe(1);
  });
  it('clips are one per day: any clip post that Eastern date fills the clip slot', () => {
    const clipSlot = wed({ type: 'clip', instant: '2026-10-28T16:00:00.000Z', timeET: '12:00 PM' });
    expect(matchSlots([clipSlot], [wedPost({ type: 'clip' })], { tz })[0].state).toBe('filled');
    expect(matchSlots([clipSlot], [wedPost({ type: 'episode' })], { tz })[0].state).toBe('open');
  });
});
