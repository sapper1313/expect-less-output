import { describe, it, expect } from 'vitest';
import { weekWindow, etToUtc, isoWeekday, formatTimeET } from '../../src/main/dashboard/week';

const tz = 'America/New_York';

describe('weekWindow', () => {
  it('gives Sunday to Saturday for a Monday', () => {
    const w = weekWindow(new Date('2026-10-26T17:02:00Z'), tz);
    expect(w.startDate).toBe('2026-10-25');
    expect(w.endDate).toBe('2026-10-31');
    expect(w.today).toBe('2026-10-26');
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toBe('2026-10-25');
    expect(w.days[6]).toBe('2026-10-31');
    expect(w.startUtc).toBe('2026-10-25T04:00:00.000Z');
    expect(w.endUtcExclusive).toBe('2026-11-01T04:00:00.000Z');
  });
  it('keeps Saturday late evening in the same week', () => {
    const w = weekWindow(new Date('2026-11-01T02:30:00Z'), tz);
    expect(w.startDate).toBe('2026-10-25');
    expect(w.today).toBe('2026-10-31');
  });
  it('handles the daylight saving week (25-hour Sunday)', () => {
    const w = weekWindow(new Date('2026-11-02T15:00:00Z'), tz);
    expect(w.startDate).toBe('2026-11-01');
    expect(w.startUtc).toBe('2026-11-01T04:00:00.000Z');
    expect(w.endUtcExclusive).toBe('2026-11-08T05:00:00.000Z');
    expect(w.days).toHaveLength(7);
  });
  it('treats a Sunday as the first day of its own week', () => {
    const w = weekWindow(new Date('2026-10-25T14:00:00Z'), tz);
    expect(w.startDate).toBe('2026-10-25');
  });
});

describe('etToUtc', () => {
  it('uses EDT before the change and EST after', () => {
    expect(etToUtc('2026-10-31', '10:00', tz)).toBe('2026-10-31T14:00:00.000Z');
    expect(etToUtc('2026-11-01', '10:00', tz)).toBe('2026-11-01T15:00:00.000Z');
  });
});

describe('isoWeekday / formatTimeET', () => {
  it('numbers weekdays with Monday 1 and Sunday 7', () => {
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-26')).toBe(1);
  });
  it('formats 24h times as 12h with AM/PM', () => {
    expect(formatTimeET('13:00')).toBe('1:00 PM');
    expect(formatTimeET('00:30')).toBe('12:30 AM');
    expect(formatTimeET('09:00')).toBe('9:00 AM');
    expect(formatTimeET('12:00')).toBe('12:00 PM');
  });
});
