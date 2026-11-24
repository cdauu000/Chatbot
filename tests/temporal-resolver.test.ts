import { describe, it, expect } from 'vitest';
import { TemporalResolver } from '../src/conversation/temporal-resolver.js';

describe('Milestone 3 - A7. Dedicated TemporalResolver Tests', () => {
  const FIXED_CLOCK = '2026-11-28T10:00:00+07:00'; // Saturday morning
  const resolver = new TemporalResolver(FIXED_CLOCK);

  it('parses duration hours with various Vietnamese phrasing', () => {
    expect(resolver.resolve('nghỉ 3 tiếng').duration_hours).toBe(3);
    expect(resolver.resolve('ở tầm 4 tiếng').duration_hours).toBe(4);
    expect(resolver.resolve('thuê 2h').duration_hours).toBe(2);
    expect(resolver.resolve('ở trong 5 giờ').duration_hours).toBe(5);
  });

  it('distinguishes check-in time from duration hours', () => {
    // "2h chiều" must be check-in time 14:00, NOT duration
    const res1 = resolver.resolve('đến lúc 2h chiều ở tầm 3 tiếng');
    expect(res1.checkin_time).toBe('14:00');
    expect(res1.duration_hours).toBe(3);

    // "17h" as military time checkin
    const res2 = resolver.resolve('vào lúc 17h, thuê 4 tiếng');
    expect(res2.checkin_time).toBe('17:00');
    expect(res2.duration_hours).toBe(4);
  });

  it('parses relative dates and weekdays in Vietnamese', () => {
    // Today
    const resToday = resolver.resolve('chiều hôm nay lúc 15h');
    expect(resToday.checkin_date).toBe('2026-11-28');
    expect(resToday.checkin_time).toBe('15:00');

    // Tomorrow
    const resTomorrow = resolver.resolve('ngày mai lúc 10h sáng');
    expect(resTomorrow.checkin_date).toBe('2026-11-29');
    expect(resTomorrow.checkin_time).toBe('10:00');

    // Upcoming weekday
    const resNextFriday = resolver.resolve('thứ 6 tuần tới lúc 14h');
    expect(resNextFriday.checkin_date).toBeDefined();
  });

  it('detects stay types: qua_dem, ngay_dem, nghi_gio', () => {
    expect(resolver.resolve('muốn ở qua đêm').stay_type).toBe('qua_dem');
    expect(resolver.resolve('thuê theo ngày').stay_type).toBe('ngay_dem');
    expect(resolver.resolve('nghỉ theo giờ tầm 3 tiếng').stay_type).toBe('nghi_gio');
  });

  it('handles text without diacritics', () => {
    const res = resolver.resolve('chieu mai luc 3h chieu thue 2 tieng');
    expect(res.checkin_time).toBe('15:00');
    expect(res.duration_hours).toBe(2);
  });
});
