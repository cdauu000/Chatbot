import { StayType } from '../domain/types.js';

/**
 * J Collection AI Concierge - Temporal Reference Resolver
 * Parses Vietnamese relative dates, weekdays, hours, and duration.
 * Supports configurable fixed clock for deterministic testing in Asia/Ho_Chi_Minh.
 */

export interface TemporalResolutionResult {
  checkin_date?: string; // YYYY-MM-DD
  checkin_time?: string; // HH:MM
  checkin_datetime?: string; // ISO 8601 string
  stay_type?: StayType;
  duration_hours?: number;
  is_duration_ambiguous?: boolean;
}

export class TemporalResolver {
  private baseDate: Date;

  constructor(fixedClockIso?: string) {
    this.baseDate = fixedClockIso ? new Date(fixedClockIso) : new Date();
  }

  public setClock(isoString: string): void {
    this.baseDate = new Date(isoString);
  }

  public setReferenceClock(isoString: string): void {
    this.baseDate = new Date(isoString);
  }

  /**
   * Parses time expressions from customer utterance
   */
  public resolve(text: string): TemporalResolutionResult {
    const norm = text.toLowerCase();
    const result: TemporalResolutionResult = {};

    // 0. Stay Type Detection
    if (
      norm.includes('qua đêm') ||
      norm.includes('qua dem') ||
      norm.includes('overnight') ||
      norm.includes('đến trưa mai') ||
      norm.includes('den trua mai') ||
      norm.includes('đến 12h trưa mai') ||
      norm.includes('đến sáng mai') ||
      norm.includes('den sang mai') ||
      norm.includes('nghỉ đêm') ||
      norm.includes('nghi dem')
    ) {
      result.stay_type = 'qua_dem';
    } else if (norm.includes('theo ngày') || norm.includes('theo ngay') || norm.includes('ngay dem') || norm.includes('cả ngày')) {
      result.stay_type = 'ngay_dem';
    } else if (norm.includes('nghỉ giờ') || norm.includes('nghi gio') || norm.includes('theo giờ') || norm.includes('theo gio')) {
      result.stay_type = 'nghi_gio';
    }

    // 1. Duration Extraction (e.g. "nghỉ 4 tiếng", "thuê 4h", "ở tầm 3 tiếng", "3 tiếng", "3h", "thue 2 tieng")
    // Important: Do not match if followed by chiều/chieu, tối/toi, sáng/sang, trưa/trua
    const durationMatch =
      norm.match(/(?:nghỉ|nghi|thuê|thue|ở|o|trong|tầm|tam|khoảng|khoang)\s*(\d+)\s*(?:tiếng|tieng|giờ|gio)(?!\s*(?:chiều|chieu|tối|toi|sáng|sang|trưa|trua))/) ||
      norm.match(/(?:nghỉ|nghi|thuê|thue|ở|o|trong|tầm|tam|khoảng|khoang)\s*(\d+)\s*h\b(?!\s*(?:chiều|chieu|tối|toi|sáng|sang|trưa|trua))/) ||
      norm.match(/(\d+)\s*(?:tiếng|tieng)(?!\s*(?:chiều|chieu|tối|toi|sáng|sang|trưa|trua))/) ||
      norm.match(/\b(\d+)\s*h\s*(?:thì\s*bao\s*nhiêu|thi\s*bao\s*nhieu|hết\s*bao\s*nhiêu|het\s*bao\s*nhieu|nhiêu|nhieu|giá|gia)/);

    if (durationMatch) {
      const dur = parseInt(durationMatch[1], 10);
      if (Number.isFinite(dur) && dur >= 1) {
        result.duration_hours = dur;
        if (!result.stay_type) {
          result.stay_type = 'nghi_gio';
        }
      }
    }

    // 2. Check-in Time Extraction (e.g. "9h sáng", "17h", "5h chiều", "19h", "4h sáng", "2h chiều")
    let hour: number | undefined;
    let minute = 0;

    // Check with/without diacritics
    const pmMatch = norm.match(/(\d{1,2})(?:h|:(\d{2}))?\s*(?:chiều|chieu|tối|toi)/);
    const amMatch = norm.match(/(\d{1,2})(?:h|:(\d{2}))?\s*(?:sáng|sang|trưa|trua)/);
    const militaryMatch = norm.match(/(?:lúc|khoảng|tầm|tới|đến|vào|sang|từ|tu)\s*(\d{1,2})(?:h|:(\d{2}))/);
    const colonTimeMatch = norm.match(/\b([0-2]?\d):([0-5]\d)\b/);
    const exactHourMatch = norm.match(/\b([0-2]?\d)h(\d{2})?\b/);

    if (pmMatch) {
      let h = parseInt(pmMatch[1], 10);
      if (h < 12) h += 12;
      hour = h;
      if (pmMatch[2]) minute = parseInt(pmMatch[2], 10);
    } else if (amMatch) {
      let h = parseInt(amMatch[1], 10);
      if (h === 12 && (norm.includes('trưa') || norm.includes('trua'))) h = 12;
      hour = h;
      if (amMatch[2]) minute = parseInt(amMatch[2], 10);
    } else if (colonTimeMatch) {
      hour = parseInt(colonTimeMatch[1], 10);
      minute = parseInt(colonTimeMatch[2], 10);
    } else if (militaryMatch) {
      // e.g. "lúc 17h", "tầm 19h", "đến lúc 4h", "vào 14h"
      hour = parseInt(militaryMatch[1], 10);
      if (militaryMatch[2]) minute = parseInt(militaryMatch[2], 10);
    } else if (exactHourMatch && !durationMatch) {
      const parsedH = parseInt(exactHourMatch[1], 10);
      if (parsedH >= 0 && parsedH <= 23) {
        hour = parsedH;
        if (exactHourMatch[2]) minute = parseInt(exactHourMatch[2], 10);
      }
    }

    if (hour !== undefined) {
      const padH = String(hour).padStart(2, '0');
      const padM = String(minute).padStart(2, '0');
      result.checkin_time = `${padH}:${padM}`;
    }

    // 3. Date / Day-of-Week Extraction
    // Support "hôm nay", "ngày mai", "thứ Bảy này", "thứ 7", "chủ nhật", "thứ 2"...
    let targetDate: Date | undefined;

    const weekdayMap: Record<string, number> = {
      'thứ 2': 1,
      'thứ hai': 1,
      'thu 2': 1,
      'thu hai': 1,
      'thứ 3': 2,
      'thứ ba': 2,
      'thu 3': 2,
      'thu ba': 2,
      'thứ 4': 3,
      'thứ tư': 3,
      'thu 4': 3,
      'thu tu': 3,
      'thứ bốn': 3,
      'thu bon': 3,
      'thứ 5': 4,
      'thứ năm': 4,
      'thu 5': 4,
      'thu nam': 4,
      'thứ 6': 5,
      'thứ sáu': 5,
      'thu 6': 5,
      'thu sau': 5,
      'thứ 7': 6,
      'thứ bảy': 6,
      'thu 7': 6,
      'thu bay': 6,
      'chủ nhật': 7,
      'chu nhat': 7,
      'cn': 7,
      'cuối tuần': 6,
    };

    let matchedDayOfWeek: number | undefined;
    const sortedWeekdayEntries = Object.entries(weekdayMap).sort((a, b) => b[0].length - a[0].length);
    for (const [key, dow] of sortedWeekdayEntries) {
      const regex = new RegExp(`(^|\\s)${key}($|\\s|[.,!?:])`, 'i');
      if (regex.test(norm)) {
        matchedDayOfWeek = dow;
        break;
      }
    }

    if (matchedDayOfWeek !== undefined) {
      targetDate = this.getDateForUpcomingDayOfWeek(matchedDayOfWeek);
    } else if (
      norm.includes('hôm nay') ||
      norm.includes('hom nay') ||
      norm.includes('tối nay') ||
      norm.includes('toi nay') ||
      norm.includes('chiều nay') ||
      norm.includes('chieu nay')
    ) {
      targetDate = new Date(this.baseDate);
    } else if (
      norm.includes('ngày mai') ||
      norm.includes('ngay mai') ||
      (norm.includes('mai') && !norm.includes('trưa mai') && !norm.includes('trua mai') && !norm.includes('sáng mai') && !norm.includes('sang mai'))
    ) {
      targetDate = new Date(this.baseDate.getTime() + 24 * 60 * 60 * 1000);
    }

    // Explicit date pattern: YYYY-MM-DD or DD/MM/YYYY
    const dmyMatch = norm.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : this.baseDate.getFullYear();
      targetDate = new Date(year, month, day);
    }

    if (targetDate) {
      const y = targetDate.getFullYear();
      const m = String(targetDate.getMonth() + 1).padStart(2, '0');
      const d = String(targetDate.getDate()).padStart(2, '0');
      result.checkin_date = `${y}-${m}-${d}`;
    }

    // If checkin_time is missing but stay_type is qua_dem, default time to 22:00
    if (!result.checkin_time && result.stay_type === 'qua_dem') {
      result.checkin_time = '22:00';
    }

    // Combine date + time into ISO datetime in Asia/Ho_Chi_Minh (+07:00)
    if (result.checkin_date && result.checkin_time) {
      result.checkin_datetime = `${result.checkin_date}T${result.checkin_time}:00+07:00`;
    }

    return result;
  }

  /**
   * Calculates date for upcoming day of week (1=Mon ... 7=Sun) relative to baseDate.
   */
  private getDateForUpcomingDayOfWeek(targetDayOfWeekIso: number): Date {
    const currentDay = this.baseDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const currentDayIso = currentDay === 0 ? 7 : currentDay;

    let diffDays = targetDayOfWeekIso - currentDayIso;
    if (diffDays < 0) {
      diffDays += 7;
    }

    const target = new Date(this.baseDate);
    target.setDate(target.getDate() + diffDays);
    return target;
  }
}
