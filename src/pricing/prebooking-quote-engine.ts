import { NormalizedDataset } from '../domain/normalized-schema.js';
import { CheckinPricingResolver } from './checkin-pricing-resolver.js';
import { PreBookingQuoteRequest, PreBookingQuoteResult, calculateQuote } from './quote-types.js';
import { isRoomNotForSale, getRoomOperationalRecord } from '../domain/room-business-registry.js';
import { AutomatedPricingOracle } from './automated-pricing-oracle.js';

export class PreBookingQuoteEngine {
  private resolver: CheckinPricingResolver;
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
    this.resolver = new CheckinPricingResolver(dataset);
  }

  /**
   * Generates a pre-booking quote for a room stay.
   * If stay_type is 'nghi_gio', duration_hours must be a finite integer >= 2.
   * For package stays ('qua_dem', 'ngay_dem'), uses package price without extra hour logic.
   */
  public getQuote(request: PreBookingQuoteRequest): PreBookingQuoteResult {
    const stayType = request.stay_type ?? 'nghi_gio';
    const isHourly = stayType === 'nghi_gio';
    const durationHours = isHourly ? (request.duration_hours ?? 2) : 1;

    // Room Business Registry: NOT_FOR_SALE room check (distinct from INVALID_ROOM or OCCUPIED)
    if (isRoomNotForSale(request.co_so_ma, request.ma_phong)) {
      const record = getRoomOperationalRecord(request.co_so_ma, request.ma_phong);
      return {
        co_so_ma: request.co_so_ma,
        ma_phong: request.ma_phong,
        ten_phong: 'Phòng 401 (Không kinh doanh)',
        stay_type: stayType,
        duration_hours: durationHours,
        is_resolved: false,
        base_2h_price: undefined,
        extra_hours: 0,
        extra_hour_rate: 0,
        total_estimate: undefined,
        pricing_status: 'NOT_FOR_SALE',
        price_breakdown_text:
          record?.display_explanation ?? 'Phòng 401 tại cơ sở Jacayl Hà Đông không sử dụng để kinh doanh.',
        policy_id: 'CANONICAL_ROOM_IDENTITY_POLICY',
        policy_version: 'V1.4.3',
        checkin_applied: undefined,
        evidence_references: [
          `Room Business Registry: ${request.co_so_ma}::${request.ma_phong} = NOT_FOR_SALE`
        ],
      };
    }

    // Minimum hourly duration enforcement (Section 5)
    if (isHourly && (durationHours < 2 || !Number.isInteger(durationHours))) {
      const room = this.dataset.phong.find(
        (p) => p.co_so_ma === request.co_so_ma && p.ma_phong === request.ma_phong
      );
      const roomName = room ? room.ten_phong : request.ma_phong;
      return {
        co_so_ma: request.co_so_ma,
        ma_phong: request.ma_phong,
        ten_phong: roomName,
        stay_type: 'nghi_gio',
        duration_hours: durationHours,
        is_resolved: false,
        base_2h_price: undefined,
        extra_hours: 0,
        extra_hour_rate: room ? room.gia_goc_dataset.gio_phat_sinh_ap_dung : 100000,
        total_estimate: undefined,
        pricing_status: 'DECLINED_AS_UNSUPPORTED_PACKAGE',
        price_breakdown_text: 'J Collection không cung cấp gói nghỉ giờ 1 tiếng. Thời gian nghỉ giờ tối thiểu là 2 tiếng.',
        policy_id: 'J_COLLECTION_BUSINESS_POLICY_V1_4_3',
        policy_version: '1.4.3',
        checkin_applied: undefined,
        evidence_references: [
          'Business Policy V1.4.3: minimum_hourly_duration = 2, one_hour_package_available = false'
        ],
      };
    }

    const resolution = this.resolver.resolvePrice({
      co_so_ma: request.co_so_ma,
      ma_phong: request.ma_phong,
      stay_type: stayType,
      checkin_datetime: request.checkin_datetime,
    });

    const room = this.dataset.phong.find(
      (p) => p.co_so_ma === request.co_so_ma && p.ma_phong === request.ma_phong
    );

    const roomName = room ? room.ten_phong : request.ma_phong;
    const quote = calculateQuote(resolution, roomName, durationHours, request.checkout_datetime);
    AutomatedPricingOracle.assertValidQuote(quote, this.dataset);
    return quote;
  }
}
