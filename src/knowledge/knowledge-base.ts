import { NormalizedDataset } from '../domain/normalized-schema.js';
import { CoSoMa } from '../domain/types.js';
import { KnowledgeItem, KnowledgeTopic, VerificationStatus } from './knowledge-types.js';

export class KnowledgeBase {
  private items: Map<string, KnowledgeItem> = new Map();

  constructor(dataset: NormalizedDataset) {
    this.populateFromDataset(dataset);
  }

  private addItem(item: KnowledgeItem): void {
    this.items.set(item.id, item);
  }

  private populateFromDataset(dataset: NormalizedDataset): void {
    // 1. Facility Knowledge
    for (const cs of dataset.co_so) {
      // Address
      this.addItem({
        id: `FAC_${cs.ma}_ADDR`,
        topic: 'FACILITY_INFO',
        scope: 'FACILITY',
        facility_id: cs.ma,
        key: 'dia_chi',
        source_reference: `j_collection_dataset.json#co_so[${cs.ma}].dia_chi`,
        verification_status: 'CONFIRMED',
        version: '1.4.2',
        original_value: cs.dia_chi,
        normalized_value: cs.dia_chi,
        guidance_for_assistant: `Địa chỉ chính thức của ${cs.ten}: ${cs.dia_chi}.`,
      });

      // Contact & Phone
      if (cs.dien_thoai) {
        this.addItem({
          id: `FAC_${cs.ma}_PHONE`,
          topic: 'CONTACT_AND_BOOKING',
          scope: 'FACILITY',
          facility_id: cs.ma,
          key: 'dien_thoai',
          source_reference: `j_collection_dataset.json#co_so[${cs.ma}].dien_thoai`,
          verification_status: 'CONFIRMED',
          version: '1.4.2',
          original_value: cs.dien_thoai,
          normalized_value: cs.dien_thoai,
          guidance_for_assistant: `Hotline lễ tân chính thức của ${cs.ten}: ${cs.dien_thoai}. Tuyệt đối không dùng số điện thoại khác.`,
        });
      }

      // Zalo
      if (cs.zalo) {
        this.addItem({
          id: `FAC_${cs.ma}_ZALO`,
          topic: 'CONTACT_AND_BOOKING',
          scope: 'FACILITY',
          facility_id: cs.ma,
          key: 'zalo',
          source_reference: `j_collection_dataset.json#co_so[${cs.ma}].zalo`,
          verification_status: 'CONFIRMED',
          version: '1.4.2',
          original_value: cs.zalo,
          normalized_value: cs.zalo,
          guidance_for_assistant: `Zalo chính thức của ${cs.ten}: ${cs.zalo}.`,
        });
      }

      // Booking link
      if (cs.link) {
        this.addItem({
          id: `FAC_${cs.ma}_LINK`,
          topic: 'CONTACT_AND_BOOKING',
          scope: 'FACILITY',
          facility_id: cs.ma,
          key: 'link_co_so',
          source_reference: `j_collection_dataset.json#co_so[${cs.ma}].link`,
          verification_status: 'CONFIRMED',
          version: '1.4.2',
          original_value: cs.link,
          normalized_value: cs.link,
          guidance_for_assistant: `Link đặt phòng chính thức của ${cs.ten}: ${cs.link}. Không tự tạo domain khác.`,
        });
      }

      // Parking policy
      const doXeVal = cs.do_xe.status === 'CONFIRMED_TRUE' ? cs.do_xe.value : 'Có chỗ đỗ xe';
      this.addItem({
        id: `FAC_${cs.ma}_PARKING`,
        topic: 'OPERATIONAL_BOUNDARY',
        scope: 'FACILITY',
        facility_id: cs.ma,
        key: 'do_xe',
        source_reference: `j_collection_dataset.json#quy_dinh.do_xe`,
        verification_status: cs.do_xe.status === 'CONFIRMED_TRUE' ? 'CONFIRMED' : 'UNCONFIRMED',
        version: '1.4.3',
        original_value: 'Có chỗ đỗ xe.',
        normalized_value: 'Có chỗ đỗ xe.',
        guidance_for_assistant: 'Dạ bên em có chỗ đỗ xe ạ. Không suy luận loại xe, khoảng cách, vị trí hoặc mức phí khi chưa có bằng chứng chi tiết hơn.',
      });
    }

    // 2. Stay Type Policies from quy_dinh & Business Policy V1.4.3
    this.addItem({
      id: 'POLICY_WEEKDAY_VS_WEEKEND',
      topic: 'PRICING_POLICY',
      scope: 'GLOBAL',
      key: 'gia_ngay_thuong_va_cuoi_tuan',
      source_reference: 'j_collection_business_policy_v1_4_3.json#facilities.jacayl-ha-dong.daytime_rates',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Biểu giá ban ngày Hà Đông phân biệt ngày thường (T2-T6) và cuối tuần (T7-CN). Các cơ sở khác áp dụng biểu giá niêm yết theo dataset.',
      normalized_value: { has_weekend_rate_ha_dong: true },
      guidance_for_assistant: 'Tại Jacayl Hà Đông, khung giờ ban ngày (08:00 - 18:00) có phân biệt giá ngày thường (T2-T6: Standard 159k, Deluxe 279k, Suite 399k) và cuối tuần (T7-CN: Standard 180k, Deluxe 279k, Suite 449k). Các cơ sở khác áp dụng biểu giá niêm yết không đổi theo ngày trong tuần.',
    });

    this.addItem({
      id: 'POLICY_DAYTIME_18H_BOUNDARY',
      topic: 'PRICING_POLICY',
      scope: 'GLOBAL',
      key: 'ranh_gioi_18h_ban_ngay',
      source_reference: 'j_collection_business_policy_v1_4_3.json#scope.cross_window_behavior',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Giá tính theo thời điểm check-in (CHECKIN_TIMESTAMP), khóa giá gốc (KEEP_CHECKIN_BASE_PRICE). Sau 18h áp dụng giá gốc dataset.',
      normalized_value: { cross_window_behavior: 'KEEP_CHECKIN_BASE_PRICE', after_18_source: 'BASE_DATASET' },
      guidance_for_assistant: 'Khung giá ban ngày kết thúc trước 18:00. Giá gói 2 giờ đầu được xác định cố định theo thời điểm nhận phòng (check-in timestamp). Khách nhận phòng trước 18:00 (ví dụ 17:00) được giữ nguyên đơn giá ban ngày cho 2 giờ đầu dù ở vắt qua sau 18:00; nhận phòng từ 18:00 trở đi áp dụng giá theo biểu giá niêm yết dataset.',
    });
    this.addItem({
      id: 'POLICY_OVERNIGHT_HOURS',
      topic: 'STAY_TYPE_POLICY',
      scope: 'GLOBAL',
      key: 'gio_qua_dem',
      source_reference: 'j_collection_business_policy_v1_4_3.json#stay_package_eligibility.overnight',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Từ 22h đến 12h hôm sau (hỗ trợ nhận sớm từ 21h40)',
      normalized_value: { start: '22:00', earliest_checkin: '21:40', end: '12:00', grace_minutes: 20 },
      guidance_for_assistant: 'Khung giờ nghỉ qua đêm chính thức: Nhận phòng từ 22:00 hôm trước đến 12:00 trưa hôm sau. Khách sạn hỗ trợ nhận phòng sớm tối đa 20 phút (từ 21:40) vẫn áp dụng trọn gói giá qua đêm.',
    });

    this.addItem({
      id: 'POLICY_OVERNIGHT_EARLY_CHECKIN_GRACE',
      topic: 'STAY_TYPE_POLICY',
      scope: 'GLOBAL',
      key: 'nhan_phong_qua_dem_som_20p',
      source_reference: 'j_collection_business_policy_v1_4_3.json#stay_package_eligibility.overnight',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Hỗ trợ khách nhận phòng qua đêm sớm tối đa 20 phút (mốc sớm nhất 21:40)',
      normalized_value: { earliest_overnight_checkin: '21:40', grace_minutes: 20 },
      guidance_for_assistant: 'Hỗ trợ nhận phòng qua đêm sớm tối đa 20 phút (từ 21:40). Khách muốn nhận phòng trước 21:40 để ở qua đêm/đến trưa mai áp dụng gói Ngày Đêm nếu nhận ngay.',
    });

    this.addItem({
      id: 'POLICY_DAILY_HOURS',
      topic: 'STAY_TYPE_POLICY',
      scope: 'GLOBAL',
      key: 'gio_ngay_dem',
      source_reference: 'j_collection_business_policy_v1_4_3.json#stay_package_eligibility.day_night',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Từ 14h đến 12h hôm sau',
      normalized_value: { start: '14:00', end: '12:00' },
      guidance_for_assistant: 'Khung giờ nghỉ ngày đêm (theo ngày) chính thức: Nhận phòng từ 14:00 hôm trước đến 12:00 trưa hôm sau. Áp dụng cho khách muốn nhận phòng trước 21:40 và ở qua đêm đến trưa mai nếu nhận ngay.',
    });

    this.addItem({
      id: 'POLICY_HOURLY_BASE',
      topic: 'STAY_TYPE_POLICY',
      scope: 'GLOBAL',
      key: 'gio_nghi_gio',
      source_reference: 'j_collection_business_policy_v1_4_3.json#scope.minimum_hourly_duration',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Thời gian nghỉ giờ tối thiểu 2 tiếng, không có gói 1 tiếng.',
      normalized_value: { minimum_hourly_duration: 2, one_hour_package_available: false },
      guidance_for_assistant: 'J Collection không cung cấp gói nghỉ giờ 1 tiếng. Thời gian nghỉ giờ tối thiểu là 2 tiếng.',
    });

    this.addItem({
      id: 'POLICY_MINIMUM_STAY_HOURLY',
      topic: 'STAY_TYPE_POLICY',
      scope: 'GLOBAL',
      key: 'thoi_gian_nghi_toi_thieu',
      source_reference: 'j_collection_business_policy_v1_4_3.json#scope.minimum_hourly_duration',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: '2 tiếng',
      normalized_value: 2,
      guidance_for_assistant: 'Bên em áp dụng thời gian nghỉ giờ tối thiểu 2 tiếng, không có gói riêng 1 tiếng ạ.',
    });

    this.addItem({
      id: 'POLICY_OVERTIME_10MIN',
      topic: 'OPERATIONAL_BOUNDARY',
      scope: 'GLOBAL',
      key: 'phu_thu_qua_gio',
      source_reference: 'j_collection_business_policy_v1_4_3.json#overtime_grace_policy',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Sau 10p bên em tính giờ tiếp theo',
      normalized_value: { grace_period_minutes: 10, charge_from_minute: 11, charge_unit_hours: 1 },
      guidance_for_assistant: 'Quy định quá giờ: Sau 10p bên em tính giờ tiếp theo. Trễ đúng 10 phút chưa vượt ngưỡng; bắt đầu từ phút thứ 11 thuộc ngưỡng tính thêm 1 giờ phát sinh.',
    });

    this.addItem({
      id: 'POLICY_OVERTIME_GRACE_PERIOD',
      topic: 'OPERATIONAL_BOUNDARY',
      scope: 'GLOBAL',
      key: 'nguong_qua_gio_10p',
      source_reference: 'j_collection_business_policy_v1_4_3.json#overtime_grace_policy',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Sau 10p bên em tính giờ tiếp theo',
      normalized_value: { grace_minutes: 10, charge_from_minute: 11 },
      guidance_for_assistant: 'Dạ sau 10p bên em tính giờ tiếp theo ạ.',
    });

    this.addItem({
      id: 'POLICY_EARLY_MORNING_PRICING',
      topic: 'PRICING_POLICY',
      scope: 'FACILITY',
      facility_id: 'jacayl-ha-dong',
      key: 'gia_truoc_08h',
      source_reference: 'j_collection_business_policy_v1_4_3.json#facilities.jacayl-ha-dong.time_windows.early_morning',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Khung 00:00 - 07:59 áp dụng theo giá gốc nghỉ giờ trong dataset.',
      normalized_value: { applies_dataset_base: true },
      guidance_for_assistant: 'Khung giá ban ngày của Jacayl Hà Đông chỉ áp dụng từ 08:00 đến trước 18:00. Ngoài thời gian này (trước 08:00 và sau 18:00), khách sạn dùng giá gốc nghỉ giờ trong dataset.',
    });

    this.addItem({
      id: 'POLICY_EXTRA_HOUR_DEFAULT',
      topic: 'PRICING_POLICY',
      scope: 'GLOBAL',
      key: 'gio_phat_sinh_mac_dinh',
      source_reference: 'j_collection_dataset.json#quy_dinh.gio_phat_sinh_mac_dinh',
      verification_status: 'CONFIRMED',
      version: '1.4.2',
      original_value: '100000',
      normalized_value: 100000,
      guidance_for_assistant: 'Mức phụ thu giờ phát sinh mặc định là 100.000đ/giờ (nếu phòng có giá giờ phát sinh riêng như 601/602 Hà Đông 200.000đ/giờ thì dùng giá riêng của phòng).',
    });

    // 3. Operational Boundaries from quy_dinh
    this.addItem({
      id: 'POLICY_CANCELLATION_REFUND',
      topic: 'OPERATIONAL_BOUNDARY',
      scope: 'GLOBAL',
      key: 'huy_phong',
      source_reference: 'j_collection_dataset.json#quy_dinh.huy_phong',
      verification_status: 'CONFIRMED',
      version: '1.4.2',
      original_value: 'Do nhân viên (người thật) xử lý, chatbot không xử lý.',
      normalized_value: { handled_by: 'HUMAN_STAFF', chatbot_handles: false },
      guidance_for_assistant: 'Chính sách hủy phòng và hoàn tiền do nhân viên lễ tân trực tiếp xử lý, chatbot không tự quyết định hủy hay hoàn tiền.',
    });

    // 4. Unknown / Unconfirmed Policy Registry
    this.addItem({
      id: 'REGISTRY_PET_POLICY_UNKNOWN',
      topic: 'UNKNOWN_UNCONFIRMED_REGISTRY',
      scope: 'GLOBAL',
      key: 'thu_cung',
      source_reference: 'UNVERIFIED_IN_DATASET',
      verification_status: 'UNKNOWN',
      version: '1.4.2',
      original_value: 'Không có dữ liệu quy định về thú cưng trong dataset.',
      normalized_value: null,
      guidance_for_assistant: 'Chưa có thông tin chính thức về việc cho phép mang thú cưng. Cần trả lời trung thực là chưa có dữ liệu và hướng dẫn khách liên hệ trực tiếp lễ tân cơ sở.',
    });

    this.addItem({
      id: 'REGISTRY_SMOKING_POLICY_UNKNOWN',
      topic: 'UNKNOWN_UNCONFIRMED_REGISTRY',
      scope: 'GLOBAL',
      key: 'hut_thuoc',
      source_reference: 'UNVERIFIED_IN_DATASET',
      verification_status: 'UNKNOWN',
      version: '1.4.2',
      original_value: 'Không có dữ liệu quy định về hút thuốc trong dataset.',
      normalized_value: null,
      guidance_for_assistant: 'Chưa có thông tin chính thức về quy định hút thuốc trong phòng. Cần hướng dẫn khách xác minh với lễ tân cơ sở.',
    });

    this.addItem({
      id: 'REGISTRY_THIRD_PERSON_SURCHARGE_UNKNOWN',
      topic: 'UNKNOWN_UNCONFIRMED_REGISTRY',
      scope: 'GLOBAL',
      key: 'phu_thu_nguoi_thu_ba',
      source_reference: 'UNVERIFIED_IN_DATASET',
      verification_status: 'UNKNOWN',
      version: '1.4.2',
      original_value: 'Không có thông tin về phụ thu thêm người thứ ba.',
      normalized_value: null,
      guidance_for_assistant: 'Chưa có quy định về phụ thu người thứ ba trong phòng. Cần hướng dẫn khách liên hệ lễ tân.',
    });

    this.addItem({
      id: 'POLICY_HOLIDAY_PRICING',
      topic: 'PRICING_POLICY',
      scope: 'GLOBAL',
      key: 'gia_ngay_le',
      source_reference: 'j_collection_business_policy_v1_4_3.json#holiday_policy',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'J Collection không tăng giá riêng vào ngày lễ hoặc ngày đặc biệt. Giá áp dụng theo biểu giá thông thường của cơ sở, ngày và giờ nhận phòng.',
      normalized_value: { has_holiday_surcharge: false, holiday_multiplier: 1.0 },
      guidance_for_assistant: 'J Collection không tăng giá riêng vào ngày lễ hoặc ngày đặc biệt. Giá áp dụng theo biểu giá thông thường của cơ sở, ngày và giờ nhận phòng.',
    });

    // Backward-compatibility alias
    this.addItem({
      id: 'REGISTRY_HOLIDAY_PRICING_UNCONFIRMED',
      topic: 'PRICING_POLICY',
      scope: 'GLOBAL',
      key: 'gia_ngay_le',
      source_reference: 'j_collection_business_policy_v1_4_3.json#holiday_policy',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'J Collection không tăng giá riêng vào ngày lễ hoặc ngày đặc biệt.',
      normalized_value: { has_holiday_surcharge: false },
      guidance_for_assistant: 'J Collection không tăng giá riêng vào ngày lễ hoặc ngày đặc biệt. Giá áp dụng theo biểu giá thông thường của cơ sở, ngày và giờ nhận phòng.',
    });

    this.addItem({
      id: 'REGISTRY_DISCOUNT_VOUCHER_UNCONFIRMED',
      topic: 'UNKNOWN_UNCONFIRMED_REGISTRY',
      scope: 'GLOBAL',
      key: 'khuyen_mai_voucher',
      source_reference: 'UNVERIFIED_IN_DATASET',
      verification_status: 'UNKNOWN',
      version: '1.4.2',
      original_value: 'Không có chương trình voucher hoặc giảm giá tự động.',
      normalized_value: null,
      guidance_for_assistant: 'J Collection hiện áp dụng đồng bộ theo biểu phí niêm yết của hệ thống, không có voucher giảm giá tự động hay ưu đãi riêng do chatbot cấp.',
    });

    this.addItem({
      id: 'REGISTRY_PARKING_FEE_UNCONFIRMED',
      topic: 'UNKNOWN_UNCONFIRMED_REGISTRY',
      scope: 'GLOBAL',
      key: 'phi_gui_xe',
      source_reference: 'UNVERIFIED_IN_DATASET',
      verification_status: 'UNCONFIRMED',
      version: '1.4.2',
      original_value: 'Có chỗ đỗ xe.',
      normalized_value: null,
      guidance_for_assistant: 'Dạ bên em có chỗ đỗ xe ạ. Không suy luận loại xe, khoảng cách, vị trí hoặc mức phí khi chưa có bằng chứng chi tiết hơn.',
    });

    // 5. Unconfirmed Amenities Registry (e.g. Máy chiếu, Bồn tắm đôi)
    this.addItem({
      id: 'REGISTRY_AMENITY_PROJECTOR_UNCONFIRMED',
      topic: 'AMENITY_INFO',
      scope: 'GLOBAL',
      key: 'may_chieu',
      source_reference: 'j_collection_dataset.json',
      verification_status: 'UNCONFIRMED',
      version: '1.4.2',
      original_value: 'Tiện nghi máy chiếu không được xác nhận chính thức trong trường tiện nghi chuẩn hóa trên website.',
      normalized_value: null,
      guidance_for_assistant: 'Tiện nghi máy chiếu/rạp phim chưa được xác nhận chính thức trên hệ thống dữ liệu phòng. Khi khách hỏi, phải nêu rõ tiện nghi này cần được nhân viên cơ sở kiểm tra thực tế.',
    });

    this.addItem({
      id: 'REGISTRY_AMENITY_DOUBLE_BATHTUB_UNCONFIRMED',
      topic: 'AMENITY_INFO',
      scope: 'GLOBAL',
      key: 'bon_tam_doi',
      source_reference: 'j_collection_dataset.json',
      verification_status: 'UNCONFIRMED',
      version: '1.4.2',
      original_value: 'Website chỉ ghi nhận bồn tắm, không xác nhận quy chuẩn bồn tắm đôi.',
      normalized_value: null,
      guidance_for_assistant: 'Hệ thống có 5 phòng có bồn tắm (J Village 4 phòng, TKC phòng 1001 Đêm), nhưng thông số bồn tắm đôi chưa có bằng chứng xác nhận chính thức. Phải giải thích rõ với khách.',
    });

    // 6. Canonical Room Identity Items
    this.addItem({
      id: 'CANONICAL_ROOM_IDENTITY_601',
      topic: 'FACILITY_INFO',
      scope: 'FACILITY',
      facility_id: 'jacayl-ha-dong',
      key: 'ten_phong_601_ha_dong',
      source_reference: 'j_collection_dataset.json#jacayl-ha-dong.601-50-sac-thai',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: '50 — Sắc Thái',
      normalized_value: { room_code: '601-50-sac-thai', official_name: '50 — Sắc Thái', category: 'Concept' },
      guidance_for_assistant: 'Phòng 601 tại cơ sở Jacayl Hà Đông có tên thương mại chính thức là "50 — Sắc Thái" (hạng Concept, tính giá Suite). Tuyệt đối không dùng tên "Tổng Thống" hay tự dịch sang "50 Shades".',
    });

    this.addItem({
      id: 'NON_COMMERCIAL_ROOM_401_HA_DONG',
      topic: 'OPERATIONAL_BOUNDARY',
      scope: 'FACILITY',
      facility_id: 'jacayl-ha-dong',
      key: 'phong_401_ha_dong_khong_kinh_doanh',
      source_reference: 'OWNER_POLICY_V1_4_3#NON_COMMERCIAL_ROOM_401_HA_DONG',
      verification_status: 'CONFIRMED',
      version: '1.4.3',
      original_value: 'Phòng 401 Hà Đông tồn tại thực tế nhưng không sử dụng để kinh doanh.',
      normalized_value: { status: 'NOT_FOR_SALE' },
      guidance_for_assistant: 'Phòng 401 tại cơ sở Jacayl Hà Đông tồn tại thực tế nhưng không sử dụng để kinh doanh. Khi khách hỏi, giải thích minh bạch và gợi ý các phòng khác trong danh mục thương mại.',
    });
  }

  public getAll(): KnowledgeItem[] {
    return Array.from(this.items.values());
  }

  public getById(id: string): KnowledgeItem | undefined {
    return this.items.get(id);
  }

  public getByTopic(topic: KnowledgeTopic): KnowledgeItem[] {
    return this.getAll().filter((item) => item.topic === topic);
  }

  public getByFacility(facilityId: CoSoMa): KnowledgeItem[] {
    return this.getAll().filter((item) => item.facility_id === facilityId || item.scope === 'GLOBAL');
  }

  public query(filter: {
    topic?: KnowledgeTopic;
    facility_id?: CoSoMa;
    keyword?: string;
  }): KnowledgeItem[] {
    return this.getAll().filter((item) => {
      if (filter.topic && item.topic !== filter.topic) return false;
      if (filter.facility_id && item.facility_id && item.facility_id !== filter.facility_id) return false;
      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        const text = `${item.id} ${item.key} ${item.original_value} ${item.guidance_for_assistant}`.toLowerCase();
        if (!text.includes(kw)) return false;
      }
      return true;
    });
  }
}
