import { describe, it, expect } from 'vitest';
import { buildSlots } from '../../src/main/dashboard/slots';
import { weekWindow } from '../../src/main/dashboard/week';
import type { Brand } from '../../src/main/dashboard/types';

const tz = 'America/New_York';
const week = weekWindow(new Date('2026-10-26T17:02:00Z'), tz);

function brand(over: Partial<Brand> = {}): Brand {
  return {
    id: 1,
    name: 'Test',
    state: 'active',
    postDays: null,
    dailyCap: 1,
    episodeTimes: { weekday: ['11:00'], weekend: ['11:00'] },
    clipDays: [],
    clipTime: null,
    blackoutDates: [],
    ...over
  };
}

describe('buildSlots', () => {
  it('creates one episode slot per day when postDays is null', () => {
    expect(buildSlots([brand()], week, tz)).toHaveLength(7);
  });
  it('skips blackout dates', () => {
    const s = buildSlots([brand({ blackoutDates: ['2026-10-28'] })], week, tz);
    expect(s).toHaveLength(6);
    expect(s.some((x) => x.date === '2026-10-28')).toBe(false);
  });
  it('honors postDays', () => {
    const s = buildSlots([brand({ postDays: [1, 3, 5] })], week, tz);
    expect(s.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-28', '2026-10-30']);
  });
  it('uses weekend times on Saturday and Sunday', () => {
    const s = buildSlots(
      [brand({ episodeTimes: { weekday: ['11:00'], weekend: ['09:00'] } })],
      week,
      tz
    );
    const sat = s.find((x) => x.date === '2026-10-31');
    expect(sat?.instant).toBe('2026-10-31T13:00:00.000Z');
    expect(sat?.timeET).toBe('9:00 AM');
    const mon = s.find((x) => x.date === '2026-10-26');
    expect(mon?.instant).toBe('2026-10-26T15:00:00.000Z');
  });
  it('creates clip slots on clipDays at clipTime', () => {
    const s = buildSlots(
      [brand({ clipDays: [1, 5], clipTime: '09:00', episodeTimes: { weekday: [], weekend: [] } })],
      week,
      tz
    );
    expect(s.map((x) => [x.type, x.instant])).toEqual([
      ['clip', '2026-10-26T13:00:00.000Z'],
      ['clip', '2026-10-30T13:00:00.000Z']
    ]);
  });
  it('yields no slots for paused, on-hold and archived brands', () => {
    for (const state of ['paused', 'on-hold', 'archived'] as const) {
      expect(buildSlots([brand({ state })], week, tz)).toHaveLength(0);
    }
  });
  it('uses EST for the daylight saving week', () => {
    const w = weekWindow(new Date('2026-11-02T15:00:00Z'), tz);
    const s = buildSlots([brand({ episodeTimes: { weekday: ['10:00'], weekend: ['10:00'] } })], w, tz);
    expect(s.find((x) => x.date === '2026-11-01')?.instant).toBe('2026-11-01T15:00:00.000Z');
    expect(s.find((x) => x.date === '2026-11-02')?.instant).toBe('2026-11-02T15:00:00.000Z');
  });
  it('sorts by instant then brand then type', () => {
    const s = buildSlots([brand({ id: 2 }), brand({ id: 1 })], week, tz);
    expect(s[0].brandId).toBe(1);
    expect(s[1].brandId).toBe(2);
  });
  const trashPanda = {
    postDays: [3, 5],
    episodeTimes: { weekday: ['20:00', '10:00', '15:00'], weekend: ['10:00', '18:00'] }
  };
  it('with a daily cap of 1 expects only the earliest slot time on each post day', () => {
    const s = buildSlots([brand({ ...trashPanda, dailyCap: 1 })], week, tz);
    expect(s.map((x) => x.instant)).toEqual(['2026-10-28T14:00:00.000Z', '2026-10-30T14:00:00.000Z']);
  });
  it('with a daily cap of 2 expects the two earliest times', () => {
    const s = buildSlots([brand({ ...trashPanda, dailyCap: 2 })], week, tz);
    expect(s.map((x) => x.timeET)).toEqual(['10:00 AM', '3:00 PM', '10:00 AM', '3:00 PM']);
  });
  it('with no cap (0) expects every enabled time', () => {
    expect(buildSlots([brand({ ...trashPanda, dailyCap: 0 })], week, tz)).toHaveLength(6);
  });
});
