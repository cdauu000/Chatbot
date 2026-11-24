import { CoSoMa, RawRoomCategory, StayType } from '../domain/types.js';
import { ExtractedEntities, IntentType, WorkingMemory } from './conversation-types.js';
import { TemporalResolver } from './temporal-resolver.js';

/**
 * Remove Vietnamese accents/diacritics for flexible fuzzy matching.
 */
export function removeDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export class NLUEngine {
  private temporalResolver: TemporalResolver;

  constructor(referenceClock?: string) {
    this.temporalResolver = new TemporalResolver(referenceClock);
  }

  public setReferenceClock(clock: string): void {
    this.temporalResolver.setReferenceClock(clock);
  }

  /**
   * Main entry point: parse user utterance into intent and extracted entities.
   */
  public parse(
    utterance: string,
    memory?: WorkingMemory | null
  ): { intent: IntentType; entities: ExtractedEntities; confidence: number } {
    const rawLower = utterance.trim().toLowerCase();
    const cleanNoDiacritics = removeDiacritics(rawLower);

    // 1. Check Adversarial / Jailbreak / Manipulation
    if (this.isAdversarial(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'OUT_OF_SCOPE',
        entities: { is_adversarial_or_injection: true },
        confidence: 0.99,
      };
    }

    // 2. Check AI Identity Inquiry
    if (this.isAIIdentityInquiry(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'AI_IDENTITY_INQUIRY',
        entities: {},
        confidence: 0.95,
      };
    }

    // 3. Check In-Stay Operational Request
    if (this.isInStayOperationalRequest(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'IN_STAY_OPERATIONAL_REQUEST',
        entities: this.extractEntities(rawLower, cleanNoDiacritics),
        confidence: 0.95,
      };
    }

    // 4. Check Checkout Dispute / Operational Conflict
    if (this.isCheckoutDispute(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'CHECKOUT_DISPUTE',
        entities: this.extractEntities(rawLower, cleanNoDiacritics),
        confidence: 0.9,
      };
    }

    // 5. Check Human Assistance Request
    if (this.isHumanRequest(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'REQUEST_HUMAN',
        entities: {},
        confidence: 0.95,
      };
    }

    // 6. Check Booking Intent (Evaluated before availability so booking attempts like "giữ phòng luôn cho anh nhé" trigger booking guidance)
    const isBooking = this.isBookingIntent(rawLower, cleanNoDiacritics);
    if (isBooking) {
      return {
        intent: 'BOOKING_INTENT',
        entities: this.extractEntities(rawLower, cleanNoDiacritics),
        confidence: 0.95,
      };
    }

    // 7. Extract Entities
    const entities = this.extractEntities(rawLower, cleanNoDiacritics);

    // 8. Check Parking Inquiry & Compound Intent Handling (Section B5 & B6)
    const askedParking = this.isParkingInquiry(rawLower, cleanNoDiacritics);
    if (askedParking) {
      entities.asked_parking = true;
      const isCompound =
        cleanNoDiacritics.includes('gia') ||
        cleanNoDiacritics.includes('bao nhieu') ||
        cleanNoDiacritics.includes('bao tien') ||
        cleanNoDiacritics.includes('bon tam') ||
        cleanNoDiacritics.includes('concept') ||
        cleanNoDiacritics.includes('deluxe') ||
        cleanNoDiacritics.includes('standard');

      if (!isCompound) {
        // Pure parking question only: Return ASK_PARKING strictly
        return {
          intent: 'ASK_PARKING',
          entities,
          confidence: 0.98,
        };
      }
      entities.is_compound = true;
      if (cleanNoDiacritics.includes('gia') || cleanNoDiacritics.includes('bao nhieu') || cleanNoDiacritics.includes('bao tien')) {
        entities.asked_price = true;
      }
      if (cleanNoDiacritics.includes('bon tam') || cleanNoDiacritics.includes('ghe tinh yeu')) {
        entities.asked_amenities = true;
      }
    }

    // 9. Check Room Availability Inquiry (Section B1)
    if (this.isRoomAvailabilityInquiry(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'CHECK_ROOM_AVAILABILITY',
        entities,
        confidence: 0.95,
      };
    }

    // 10. Check Specific Room Price Inquiry (Section B4)
    if (this.isSpecificRoomPriceInquiry(rawLower, cleanNoDiacritics, entities)) {
      return {
        intent: 'ASK_SPECIFIC_ROOM_PRICE',
        entities,
        confidence: 0.92,
      };
    }

    // 11. Check Category Price Inquiry (Section B4)
    if (this.isCategoryPriceInquiry(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'ASK_CATEGORY_PRICE',
        entities,
        confidence: 0.92,
      };
    }

    // 12. Check Browse Rooms by Category (Section B3)
    if (this.isBrowseRoomsByCategory(rawLower, cleanNoDiacritics, entities)) {
      return {
        intent: 'BROWSE_ROOMS_BY_CATEGORY',
        entities,
        confidence: 0.92,
      };
    }

    // 13. Check Browse Categories Inquiry (Section B2)
    if (this.isBrowseCategories(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'BROWSE_ROOM_CATEGORIES',
        entities,
        confidence: 0.92,
      };
    }

    // 14. Check Room Image Request (Section E)
    if (this.isRequestRoomImages(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'REQUEST_ROOM_IMAGES',
        entities,
        confidence: 0.95,
      };
    }

    // 15. Check Policy Inquiry
    if (this.isPolicyInquiry(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'ASK_POLICY',
        entities,
        confidence: 0.88,
      };
    }

    // 16. Check Compare Rooms
    if (this.isCompareIntent(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'COMPARE_ROOMS',
        entities,
        confidence: 0.88,
      };
    }

    // 10. Check Constraint Retraction / Modification / Negation
    if (entities.negated_constraints && entities.negated_constraints.length > 0) {
      return {
        intent: 'NEGATE_REQUIREMENT',
        entities,
        confidence: 0.9,
      };
    }

    if (entities.cleared_negations && entities.cleared_negations.length > 0) {
      return {
        intent: 'CLEAR_NEGATION',
        entities,
        confidence: 0.9,
      };
    }

    if (
      (entities.removed_requirements && entities.removed_requirements.length > 0) ||
      (entities.removed_constraints && entities.removed_constraints.length > 0)
    ) {
      return {
        intent: 'REMOVE_REQUIREMENT',
        entities,
        confidence: 0.9,
      };
    }

    // 11. Check Cheapest / Best Option
    if (this.isCheapestInquiry(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'ASK_CHEAPEST_OPTION',
        entities,
        confidence: 0.85,
      };
    }

    // 12. Check Room Details / Price
    if (this.isRoomDetailInquiry(rawLower, cleanNoDiacritics, entities, memory)) {
      return {
        intent: 'GET_ROOM_DETAILS',
        entities,
        confidence: 0.85,
      };
    }

    // 13. Greeting
    if (this.isGreeting(rawLower, cleanNoDiacritics)) {
      return {
        intent: 'GREETING',
        entities,
        confidence: 0.8,
      };
    }

    // 14. Default to SEARCH_ROOM
    return {
      intent: 'SEARCH_ROOM',
      entities,
      confidence: 0.75,
    };
  }

  // --- Entity Extraction Helpers ---

  public extractEntities(text: string, noDia: string): ExtractedEntities {
    const entities: ExtractedEntities = {};

    // 1. Facility Extraction
    const facility = this.extractFacility(text, noDia);
    if (facility) entities.facility = facility;

    // 2. Room Code & Name Extraction
    const roomInfo = this.extractRoomIdentifier(text, noDia);
    if (roomInfo.room_name) entities.room_name = roomInfo.room_name;
    if (roomInfo.category) entities.category = roomInfo.category;

    // 3. Target Reference (e.g. "căn thứ hai", "phòng rẻ hơn", "phòng đó")
    const targetRef = this.extractTargetReference(text, noDia);
    if (targetRef) entities.target_reference = targetRef;

    // 4. Budget Extraction
    const budget = this.extractBudget(text, noDia);
    if (budget) entities.budget = budget;

    // 5. Retraction & Negated Constraints Extraction
    const retractions = this.extractRetractions(text, noDia);
    if (retractions.removed.length > 0) {
      entities.removed_constraints = retractions.removed;
      entities.removed_requirements = retractions.removed;
    }
    if (retractions.negated.length > 0) {
      entities.negated_constraints = retractions.negated;
    }
    if (retractions.cleared.length > 0) {
      entities.cleared_negations = retractions.cleared;
    }

    // 6. Must-Have Amenities Extraction
    const mustHaves = this.extractAmenities(text, noDia, retractions.allExcludedFromMustHaves);
    if (mustHaves.length > 0) entities.must_have_amenities = mustHaves;

    // 7. Temporal Extraction
    const temporal = this.temporalResolver.resolve(text);
    if (temporal.checkin_date) entities.checkin_date = temporal.checkin_date;
    if (temporal.checkin_time) entities.checkin_time = temporal.checkin_time;
    if (temporal.checkin_datetime) entities.checkin_datetime = temporal.checkin_datetime;
    if (temporal.stay_type) entities.stay_type = temporal.stay_type;
    if (temporal.duration_hours) entities.duration_hours = temporal.duration_hours;

    return entities;
  }

  private extractFacility(text: string, noDia: string): CoSoMa | undefined {
    // Jacayl Hà Đông
    if (
      text.includes('hà đông') ||
      noDia.includes('ha dong') ||
      /\bhd\b/.test(noDia) ||
      noDia.includes('van quan') ||
      noDia.includes('nguyen van loc') ||
      noDia.includes('la casta') ||
      noDia.includes('50 sac thai') ||
      noDia.includes('long chim') ||
      noDia.includes('grand canyon') ||
      noDia.includes('playboy')
    ) {
      return 'jacayl-ha-dong';
    }

    // Jacayl Trần Khát Chân
    if (
      text.includes('trần khát chân') ||
      noDia.includes('tran khat chan') ||
      /\btkc\b/.test(noDia) ||
      text.includes('khát chân') ||
      noDia.includes('1001 dem') ||
      noDia.includes('sapphire')
    ) {
      return 'jacayl-tran-khat-chan';
    }

    // J Village
    if (
      text.includes('j village') ||
      text.includes('j-village') ||
      text.includes('jvillage') ||
      text.includes('triệu việt vương') ||
      noDia.includes('trieu viet vuong') ||
      /\btvv\b/.test(noDia) ||
      noDia.includes('village') ||
      noDia.includes('crimson suite') ||
      noDia.includes('mosaic')
    ) {
      return 'j-village';
    }

    return undefined;
  }

  private extractRoomIdentifier(
    text: string,
    noDia: string
  ): { room_name?: string; category?: RawRoomCategory } {
    const res: { room_name?: string; category?: RawRoomCategory } = {};

    // Check specific room numbers (e.g. 101, 201, 301, 701)
    const numMatch = text.match(/\b([1-8]0[1-9])\b/);
    if (numMatch) {
      res.room_name = numMatch[1];
    }

    // Check thematic names
    const names = [
      '50 sắc thái',
      '50 sac thai',
      '50 shades',
      'playboy',
      'lồng chim',
      'long chim',
      'grand canyon',
      'paris',
      'tokyo',
      'santorini',
      'bali',
      'oasis',
      'himalaya',
      'vintage',
      'cinema',
      'bamboo',
      'sunset',
      'sunrise',
      'retro',
    ];
    for (const name of names) {
      if (noDia.includes(removeDiacritics(name))) {
        res.room_name = res.room_name ? `${res.room_name} ${name}` : name;
        break;
      }
    }

    // Category
    if (noDia.includes('concept')) {
      res.category = 'Concept';
    } else if (noDia.includes('suite')) {
      res.category = 'Suite';
    } else if (noDia.includes('deluxe') || noDia.includes('cao cap')) {
      res.category = 'Deluxe';
    } else if (noDia.includes('standard') || noDia.includes('tieu chuan')) {
      res.category = 'Standard';
    }

    return res;
  }

  private extractTargetReference(text: string, noDia: string): string | undefined {
    // E.g. "căn thứ hai", "phòng 2", "căn đầu tiên", "phòng rẻ hơn", "phòng đó"
    if (/c[aă]n th[uứ] hai|ph[oò]ng th[uứ] hai|c[aă]n s[oố] 2|ph[oò]ng 2|c[aă]n 2\b/.test(noDia)) {
      return 'căn thứ hai';
    }
    if (/c[aă]n th[uứ] nh[aấ]t|c[aă]n th[uứ] 1|ph[oò]ng th[uứ] nh[aấ]t|c[aă]n d[aầ]u ti[eê]n|ph[oò]ng d[aầ]u ti[eê]n/.test(noDia)) {
      return 'căn đầu tiên';
    }
    if (/c[aă]n th[uứ] ba|ph[oò]ng th[uứ] ba|c[aă]n s[oố] 3|ph[oò]ng 3|c[aă]n 3\b/.test(noDia)) {
      return 'căn thứ ba';
    }
    if (/ph[oò]ng r[eẻ] h[oơ]n|c[aă]n r[eẻ] h[oơ]n|c[aá]i r[eẻ] h[oơ]n/.test(noDia)) {
      return 'phòng rẻ hơn';
    }
    if (/ph[oò]ng d[aắ]t h[oơ]n|c[aă]n d[aắ]t h[oơ]n|c[aá]i d[aắ]t h[oơ]n/.test(noDia)) {
      return 'phòng đắt hơn';
    }
    if (/ph[oò]ng d[oó]|c[aă]n d[oó]|ph[oò]ng n[aã]y|ph[oò]ng v[uừ]a n[aã]y/.test(noDia)) {
      return 'phòng đó';
    }
    return undefined;
  }

  private extractBudget(text: string, noDia: string): number | undefined {
    // Match range forms like: "tầm 300-400k", "300 - 500k", "ngân sách 400 - 500.000"
    const rangeMatch = noDia.match(/(?:ngan sach|tam|khoang|duoi|toi da|budget|muc|gia)?\s*(\d+)\s*[-–]\s*(\d+)\s*(k|nghin|ngan|trieu|tr)?/);
    if (rangeMatch && (rangeMatch[3] || rangeMatch[0].includes('ngan sach') || rangeMatch[0].includes('budget') || rangeMatch[0].includes('tam') || rangeMatch[0].includes('khoang'))) {
      let maxVal = parseInt(rangeMatch[2], 10);
      if (rangeMatch[3] === 'trieu' || rangeMatch[3] === 'tr') {
        maxVal *= 1000000;
      } else if (rangeMatch[3] === 'k' || rangeMatch[3] === 'nghin' || rangeMatch[3] === 'ngan' || maxVal < 1000) {
        maxVal *= 1000;
      }
      return maxVal;
    }

    // Match forms with explicit budget keywords or explicit currency units:
    // 1. With keyword prefix (e.g. "tầm 400k", "ngân sách 500k", "dưới 600.000")
    const keywordMatch = noDia.match(
      /(?:ngan sach|tam|khoang|duoi|toi da|budget|muc|gia)\s*(?:la|tam)?\s*(\d{1,4}(?:\.\d{3})+|\d+)\s*(k|nghin|ngan|vnd|d|trieu|tr)?\b/
    );
    if (keywordMatch) {
      let rawNum = keywordMatch[1].replace(/\./g, '');
      let val = parseInt(rawNum, 10);
      const unit = keywordMatch[2];
      if (unit === 'trieu' || unit === 'tr') {
        val *= 1000000;
      } else if (unit === 'k' || unit === 'nghin' || unit === 'ngan' || val < 1000) {
        val *= 1000;
      }
      if (val >= 50000 && val <= 10000000) {
        return val;
      }
    }

    // 2. With explicit currency unit suffix (e.g. "400k", "500 nghìn", "1 triệu")
    const unitMatch = noDia.match(/\b(\d{1,4}(?:\.\d{3})+|\d+)\s*(k|nghin|ngan|trieu|tr)\b/);
    if (unitMatch) {
      let rawNum = unitMatch[1].replace(/\./g, '');
      let val = parseInt(rawNum, 10);
      const unit = unitMatch[2];
      if (unit === 'trieu' || unit === 'tr') {
        val *= 1000000;
      } else if (unit === 'k' || unit === 'nghin' || unit === 'ngan' || val < 1000) {
        val *= 1000;
      }
      if (val >= 50000 && val <= 10000000) {
        return val;
      }
    }

    // 3. Formatted number with thousand dots (e.g. "400.000", "500.000đ")
    const dotMatch = text.match(/\b(\d{1,3}(?:\.\d{3})+)\s*(?:vnd|d|đ)?\b/);
    if (dotMatch) {
      const val = parseInt(dotMatch[1].replace(/\./g, ''), 10);
      if (val >= 50000 && val <= 10000000) {
        return val;
      }
    }

    return undefined;
  }

  private extractRetractions(
    text: string,
    noDia: string
  ): {
    removed: string[];
    negated: string[];
    cleared: string[];
    allExcludedFromMustHaves: Set<string>;
  } {
    const removed: string[] = [];
    const negated: string[] = [];
    const cleared: string[] = [];
    const allExcludedFromMustHaves = new Set<string>();

    const checkAmenityInStr = (str: string, targetArray: string[], targetSet?: Set<string>) => {
      if (str.includes('ghe tinh yeu') || str.includes('tantra') || str.includes('ghe ty')) {
        targetArray.push('ghế tình yêu');
        targetSet?.add('ghe tinh yeu');
        targetSet?.add('tantra');
      }
      if (str.includes('bon tam') || str.includes('jacuzzi') || str.includes('bon doi') || str.includes('bon suc')) {
        targetArray.push('bồn tắm');
        targetSet?.add('bon tam');
      }
      if (str.includes('may chieu') || str.includes('chieu phim') || str.includes('projector')) {
        targetArray.push('máy chiếu');
        targetSet?.add('may chieu');
      }
      if (str.includes('ban cong')) {
        targetArray.push('ban công');
        targetSet?.add('ban cong');
      }
    };

    // 1. NEGATE_REQUIREMENT: "không lấy phòng có...", "đừng lấy phòng có...", "tránh phòng có..."
    const negatePatterns = [
      /(?:khong lay|dung lay|tranh|khong muon|khong duoc co)\s+(?:phong\s+co\s+)?([a-z0-9\s]+?)(?:nhe|nhung|,|$)/g,
    ];
    for (const pat of negatePatterns) {
      let match;
      while ((match = pat.exec(noDia)) !== null) {
        checkAmenityInStr(match[1].trim(), negated, allExcludedFromMustHaves);
      }
    }

    // 2. CLEAR_NEGATION: "thôi có bồn tắm cũng được", "bỏ cấm bồn tắm", "bỏ loại trừ bồn tắm"
    const clearPatterns = [
      /(?:thoi\s+)?co\s+([a-z0-9\s]+?)\s+cung\s+(?:duoc|ok|duyet)/g,
      /(?:bo loai tru|bo cam|khong can tranh)\s+([a-z0-9\s]+?)(?:nua|nhe|nhung|,|$)/g,
    ];
    for (const pat of clearPatterns) {
      let match;
      while ((match = pat.exec(noDia)) !== null) {
        checkAmenityInStr(match[1].trim(), cleared, allExcludedFromMustHaves);
      }
    }

    // 3. REMOVE_REQUIREMENT: "thôi không cần bồn tắm nữa", "không cần ghế tình yêu nữa", "bỏ bồn tắm đi"
    const removePatterns = [
      /(?:khong can|thoi khong can|thoi khong|bo|huy)\s+([a-z0-9\s]+?)(?:nua|nhe|nhung|,|$)/g,
    ];
    for (const pat of removePatterns) {
      let match;
      while ((match = pat.exec(noDia)) !== null) {
        checkAmenityInStr(match[1].trim(), removed, allExcludedFromMustHaves);
      }
    }

    return { removed, negated, cleared, allExcludedFromMustHaves };
  }

  private extractAmenities(text: string, noDia: string, negated: Set<string>): string[] {
    const amenities: string[] = [];

    // Bathtub
    if (
      !negated.has('bon tam') &&
      (noDia.includes('bon tam') ||
        noDia.includes('bon suc') ||
        noDia.includes('jacuzzi') ||
        noDia.includes('bon doi'))
    ) {
      amenities.push('bồn tắm');
    }

    // Projector
    if (
      !negated.has('may chieu') &&
      (noDia.includes('may chieu') ||
        noDia.includes('chieu phim') ||
        noDia.includes('projector') ||
        noDia.includes('rap phim'))
    ) {
      amenities.push('máy chiếu');
    }

    // Tantra
    if (
      !negated.has('ghe tinh yeu') &&
      !negated.has('tantra') &&
      (noDia.includes('ghe tinh yeu') || noDia.includes('tantra') || noDia.includes('ghe ty'))
    ) {
      amenities.push('ghế tình yêu');
    }

    // Balcony
    if (!negated.has('ban cong') && (noDia.includes('ban cong') || noDia.includes('thoang'))) {
      amenities.push('ban công');
    }

    // Window
    if (noDia.includes('cua so') || noDia.includes('view dep')) {
      amenities.push('cửa sổ');
    }

    // Smart TV
    if (noDia.includes('smart tv') || noDia.includes('tivi') || noDia.includes('netflix')) {
      amenities.push('smart tv');
    }

    // Kitchen
    if (noDia.includes('bep') || noDia.includes('nau an')) {
      amenities.push('bếp');
    }

    // Elevator / Parking
    if (noDia.includes('thang may')) {
      amenities.push('thang máy');
    }
    if (
      (noDia.includes('o to') || noDia.includes('oto') || noDia.includes('do xe') || noDia.includes('dau xe')) &&
      (noDia.includes('phong co') || noDia.includes('can co') || noDia.includes('tim phong'))
    ) {
      amenities.push('đỗ ô tô');
    }

    return amenities;
  }

  // --- Intent Detection Helpers ---

  private isAdversarial(text: string, noDia: string): boolean {
    const keywords = [
      'bo qua moi chi dan',
      'ignore previous instructions',
      'toi la ceo',
      'iam ceo',
      'giam gia 100',
      'mien phi toan bo',
      'voucher 100%',
      'hack',
      'system prompt',
      'cho toi mat khau',
      'bypass',
      'chi 50k thoi dung khong',
      'phong suite gia 50k',
    ];
    return keywords.some((k) => noDia.includes(k));
  }

  private isAIIdentityInquiry(text: string, noDia: string): boolean {
    return (
      noDia.includes('ban la ai') ||
      noDia.includes('em la ai') ||
      noDia.includes('nguoi that hay robot') ||
      noDia.includes('nguoi hay bot') ||
      noDia.includes('la bot a') ||
      noDia.includes('la ai ha em') ||
      noDia.includes('ai concierge') ||
      noDia.includes('tro ly ao')
    );
  }

  private isInStayOperationalRequest(text: string, noDia: string): boolean {
    return (
      noDia.includes('xin them khan') ||
      noDia.includes('nuoc suoi') ||
      noDia.includes('don phong') ||
      noDia.includes('don dep') ||
      noDia.includes('len phong') ||
      noDia.includes('dieu hoa hong') ||
      noDia.includes('goi do an') ||
      noDia.includes('sua voi nuoc') ||
      noDia.includes('phong 302 voi') ||
      noDia.includes('mang len') ||
      noDia.includes('dich vu phong')
    );
  }

  private isCheckoutDispute(text: string, noDia: string): boolean {
    return (
      noDia.includes('tinh tien sai') ||
      noDia.includes('tinh lo') ||
      noDia.includes('phu thu qua gio') ||
      noDia.includes('bat tra them') ||
      noDia.includes('sao vo ly the') ||
      noDia.includes('khieu nai') ||
      noDia.includes('gian lan') ||
      noDia.includes('tai sao lai dat the')
    );
  }

  private isHumanRequest(text: string, noDia: string): boolean {
    return (
      noDia.includes('gap nhan vien') ||
      noDia.includes('cho toi gap le tan') ||
      noDia.includes('noi chuyen voi nguoi') ||
      noDia.includes('hotline') ||
      noDia.includes('so dien thoai le tan')
    );
  }

  private isParkingInquiry(text: string, noDia: string): boolean {
    return (
      noDia.includes('cho do xe') ||
      noDia.includes('cho de xe') ||
      noDia.includes('bai do xe') ||
      noDia.includes('bai de xe') ||
      noDia.includes('bai xe') ||
      noDia.includes('gui xe') ||
      noDia.includes('cho dau xe') ||
      noDia.includes('cho de oto') ||
      noDia.includes('cho do oto') ||
      noDia.includes('do o to') ||
      noDia.includes('do oto') ||
      noDia.includes('co cho de xe') ||
      noDia.includes('co cho do xe') ||
      (noDia.includes('do xe') && !noDia.includes('bon tam'))
    );
  }

  private isRequestRoomImages(text: string, noDia: string): boolean {
    // Negation guard: "Anh không cần ảnh, anh cần giá", "đừng gửi ảnh"
    if (
      noDia.includes('khong can anh') ||
      noDia.includes('khong xem anh') ||
      noDia.includes('khong lay anh') ||
      noDia.includes('dung gui anh') ||
      noDia.includes('chua can anh') ||
      noDia.includes('khong can hinh')
    ) {
      return false;
    }

    const textLower = text.toLowerCase();
    const hasPhotoAccented =
      textLower.includes('ảnh') ||
      textLower.includes('hình') ||
      textLower.includes('photo') ||
      textLower.includes('pic');

    const hasPhotoUnaccented =
      noDia.includes('hinh anh') ||
      noDia.includes('xem anh') ||
      noDia.includes('gui anh') ||
      noDia.includes('co anh khong') ||
      noDia.includes('anh thuc te') ||
      noDia.includes('anh chup') ||
      noDia.includes('xin anh');

    if (!hasPhotoAccented && !hasPhotoUnaccented) return false;

    if (noDia.includes('tim cho') || noDia.includes('tim phong') || noDia.includes('can phong')) {
      if (!noDia.includes('xem anh') && !noDia.includes('gui anh') && !noDia.includes('hinh anh')) {
        return false;
      }
    }

    return hasPhotoAccented || hasPhotoUnaccented;
  }

  private isBrowseCategories(text: string, noDia: string): boolean {
    const isCategoryKeyword =
      noDia.includes('hang phong') ||
      noDia.includes('loai phong') ||
      noDia.includes('cac loai phong') ||
      noDia.includes('hang nao') ||
      noDia.includes('loai nao');
    const isBrowsePattern =
      noDia.includes('co nhung') ||
      noDia.includes('co may') ||
      noDia.includes('danh sach') ||
      noDia.includes('gom nhung') ||
      noDia.includes('o day co') ||
      noDia.includes('ben em co') ||
      noDia.includes('nhung hang nao') ||
      noDia.includes('co gi');

    const isPrice = noDia.includes('gia') || noDia.includes('bao nhieu') || noDia.includes('bao tien');

    return isCategoryKeyword && (isBrowsePattern || noDia.includes('3 loai') || noDia.includes('3 hang')) && !isPrice;
  }

  private isBrowseRoomsByCategory(text: string, noDia: string, entities: ExtractedEntities): boolean {
    const hasCategory =
      noDia.includes('concept') ||
      noDia.includes('deluxe') ||
      noDia.includes('standard') ||
      Boolean(entities.category);

    const isBrowsingWords =
      noDia.includes('cho xem hang') ||
      noDia.includes('xem hang') ||
      noDia.includes('cac phong') ||
      noDia.includes('phong nao thuoc') ||
      noDia.includes('phong nao la') ||
      noDia.includes('danh sach phong') ||
      noDia.includes('xem phong') ||
      noDia.includes('cho xem phong') ||
      noDia.includes('gom cac phong') ||
      noDia.includes('co nhung phong nao') ||
      noDia.includes('gom phong nao');

    return hasCategory && isBrowsingWords && !noDia.includes('gia') && !noDia.includes('bao nhieu');
  }

  private isCategoryPriceInquiry(text: string, noDia: string): boolean {
    const isPrice =
      noDia.includes('gia') ||
      noDia.includes('bao nhieu') ||
      noDia.includes('bao tien') ||
      noDia.includes('the nao') ||
      noDia.includes('nhu the nao') ||
      noDia.includes('chi phi') ||
      noDia.includes('ton kem');
    const isCategory =
      noDia.includes('3 loai') ||
      noDia.includes('ba loai') ||
      noDia.includes('3 hang') ||
      noDia.includes('ba hang') ||
      noDia.includes('cac loai') ||
      noDia.includes('cac hang') ||
      noDia.includes('hang concept') ||
      noDia.includes('hang deluxe') ||
      noDia.includes('hang standard') ||
      noDia.includes('phong concept') ||
      noDia.includes('phong standard') ||
      noDia.includes('phong deluxe') ||
      noDia.includes('gia deluxe') ||
      noDia.includes('gia standard') ||
      noDia.includes('gia concept');
    const hasSpecificRoom =
      noDia.includes('601') ||
      noDia.includes('401') ||
      noDia.includes('101') ||
      noDia.includes('201') ||
      noDia.includes('202') ||
      noDia.includes('la casta') ||
      noDia.includes('long chim');

    // If customer already provides specific duration or hour, they want a quote for that stay, not generic category price list
    const hasSpecificDuration =
      noDia.includes('tieng') ||
      noDia.includes('1 gio') ||
      noDia.includes('2 gio') ||
      noDia.includes('3 gio') ||
      noDia.includes('4 gio') ||
      noDia.includes('luc') ||
      noDia.includes('sang thu') ||
      noDia.includes('chieu thu') ||
      noDia.includes('toi thu');

    return isPrice && isCategory && !hasSpecificRoom && !hasSpecificDuration;
  }

  private isSpecificRoomPriceInquiry(text: string, noDia: string, entities: ExtractedEntities): boolean {
    const isPrice = noDia.includes('gia') || noDia.includes('bao nhieu') || noDia.includes('bao tien');
    const hasSpecificRoom =
      Boolean(entities.room_name) ||
      Boolean(entities.target_reference) ||
      noDia.includes('601') ||
      noDia.includes('401') ||
      noDia.includes('101') ||
      noDia.includes('201') ||
      noDia.includes('202') ||
      noDia.includes('la casta') ||
      noDia.includes('long chim') ||
      noDia.includes('50 sac thai');

    return isPrice && hasSpecificRoom;
  }

  private isRoomAvailabilityInquiry(text: string, noDia: string): boolean {
    if (noDia.includes('may gio nhan') || noDia.includes('gio nhan') || noDia.includes('gio check in')) {
      return false;
    }
    return (
      noDia.includes('con phong khong') ||
      noDia.includes('con phong k') ||
      noDia.includes('con phong kh') ||
      noDia.includes('con phong ko') ||
      noDia.includes('con phong trog') ||
      noDia.includes('con phong trong') ||
      noDia.includes('dang trong khong') ||
      noDia.includes('con trong khong') ||
      noDia.includes('trong phong khong') ||
      noDia.includes('co phong khong') ||
      noDia.includes('co phong k') ||
      noDia.includes('co phong de thue ngay') ||
      noDia.includes('co phong thue ngay') ||
      noDia.includes('phong dang trong') ||
      (noDia.includes('trong khong') && (noDia.includes('phong') || noDia.includes('can'))) ||
      noDia.includes('qua luon') ||
      noDia.includes('gio qua luon') ||
      noDia.includes('con cho khong') ||
      (noDia.includes('con phong') && (noDia.includes('toi nay') || noDia.includes('hom nay') || noDia.includes('ha dong')))
    );
  }

  private isBookingIntent(text: string, noDia: string): boolean {
    return (
      noDia.includes('dat phong') ||
      noDia.includes('chot phong') ||
      noDia.includes('book phong') ||
      noDia.includes('booking') ||
      noDia.includes('tao booking') ||
      noDia.includes('giu phong') ||
      noDia.includes('xac nhan giu phong') ||
      noDia.includes('toi muon dat') ||
      noDia.includes('chot can') ||
      noDia.includes('chot dat') ||
      noDia.includes('toi lay phong') ||
      noDia.includes('lay can nay') ||
      noDia.includes('anh coc') ||
      noDia.includes('em coc') ||
      noDia.includes('coc luon') ||
      noDia.includes('dat coc')
    );
  }

  private isPolicyInquiry(text: string, noDia: string): boolean {
    if (
      noDia.includes('tim phong') ||
      noDia.includes('can phong') ||
      noDia.includes('thue phong') ||
      noDia.includes('muon phong') ||
      noDia.includes('dat phong')
    ) {
      return false;
    }
    return (
      noDia.includes('chinh sach') ||
      noDia.includes('quy dinh') ||
      noDia.includes('gio check in') ||
      noDia.includes('gio check out') ||
      noDia.includes('gio nhan phong') ||
      noDia.includes('may gio nhan') ||
      noDia.includes('may gio check in') ||
      noDia.includes('may gio vao') ||
      noDia.includes('phu thu') ||
      noDia.includes('qua gio') ||
      noDia.includes('qua 10 phut') ||
      noDia.includes('qua 15 phut') ||
      noDia.includes('tra phong muon') ||
      noDia.includes('check out muon') ||
      noDia.includes('tinh phi') ||
      noDia.includes('tinh tien') ||
      noDia.includes('dat coc') ||
      noDia.includes('cho de xe') ||
      noDia.includes('bon tam doi') ||
      noDia.includes('bon doi') ||
      noDia.includes('jacuzzi doi') ||
      noDia.includes('co bep') ||
      noDia.includes('nau an') ||
      noDia.includes('nau nuong') ||
      noDia.includes('co thang may khong') ||
      noDia.includes('co cho de oto') ||
      noDia.includes('cho hut thuoc') ||
      noDia.includes('mang thu cung') ||
      noDia.includes('1 tieng') ||
      noDia.includes('1 gio') ||
      noDia.includes('nua gia') ||
      noDia.includes('giam gia') ||
      noDia.includes('ngay le') ||
      noDia.includes('valentine') ||
      noDia.includes('tet') ||
      noDia.includes('toi thieu') ||
      noDia.includes('truoc 8h') ||
      noDia.includes('truoc 08:00') ||
      noDia.includes('sau 18h') ||
      noDia.includes('khung gio') ||
      noDia.includes('co ap dung gia') ||
      noDia.includes('ap dung gia') ||
      noDia.includes('tang gia') ||
      noDia.includes('tong thong') ||
      noDia.includes('president') ||
      noDia.includes('401 ha dong') ||
      (noDia.includes('phong 401') && (noDia.includes('ha dong') || text.includes('hà đông')))
    );
  }

  private isCompareIntent(text: string, noDia: string): boolean {
    return (
      noDia.includes('so sanh') ||
      noDia.includes('khac gi nhau') ||
      noDia.includes('khac nhau the nao') ||
      noDia.includes('nen chon phong nao') ||
      noDia.includes('khac nhau cho nao')
    );
  }

  private isCheapestInquiry(text: string, noDia: string): boolean {
    return (
      noDia.includes('re nhat') ||
      noDia.includes('gia thap nhat') ||
      noDia.includes('tiet kiem nhat')
    );
  }

  private isRoomDetailInquiry(
    text: string,
    noDia: string,
    entities: ExtractedEntities,
    memory?: WorkingMemory | null
  ): boolean {
    if (entities.duration_hours || entities.checkin_time || entities.checkin_datetime) {
      return false;
    }

    // Never treat price inquiries as static room detail inquiries
    if (noDia.includes('gia') || noDia.includes('bao nhieu') || noDia.includes('bao tien')) {
      return false;
    }

    if (
      /\bco gi\b/.test(noDia) ||
      noDia.includes('chi tiet phong') ||
      noDia.includes('thong tin phong') ||
      noDia.includes('tien nghi phong')
    ) {
      return true;
    }

    if (entities.target_reference || entities.room_name) {
      if (noDia.includes('xem phong') || noDia.includes('cho anh xem') || noDia.includes('cho em xem')) {
        return true;
      }
    }

    return false;
  }

  private isGreeting(text: string, noDia: string): boolean {
    const greetings = ['chao', 'alo', 'hello', 'hi', 'hey', 'chao em', 'em oi', 'xin chao'];
    if (greetings.some((g) => noDia === g || noDia.startsWith(g + ' '))) {
      return true;
    }
    return (
      noDia.includes('hoi ve khach san') ||
      noDia.includes('thong tin ve khach san') ||
      noDia.includes('gioi thieu ve khach san') ||
      noDia.includes('chuc em ngay moi') ||
      noDia.includes('ngay moi tot lanh')
    );
  }
}
