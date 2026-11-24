import { KnowledgeBase } from './knowledge-base.js';
import { PolicyQueryResult, VerificationStatus } from './knowledge-types.js';
import { CoSoMa } from '../domain/types.js';
import { removeDiacritics } from '../conversation/nlu-engine.js';

export class PolicyQAEngine {
  private kb: KnowledgeBase;

  constructor(kb: KnowledgeBase) {
    this.kb = kb;
  }

  /**
   * Evaluates customer query and retrieves policy answer with verification status & source citation.
   * Grounded in Owner-Confirmed Business Policy V1.4.3.
   */
  public answer(query: string, facilityId?: CoSoMa): PolicyQueryResult | null {
    const rawLower = query.toLowerCase();
    const noDia = removeDiacritics(rawLower);

    // 1. Minimum Hourly Stay & 1-Hour Package Inquiry (Topic 1)
    if (
      noDia.includes('thue 1 tieng') ||
      noDia.includes('nghi 1 tieng') ||
      noDia.includes('1 tieng thoi') ||
      noDia.includes('thue 1h') ||
      noDia.includes('1 gio thoi') ||
      noDia.includes('nua gia') ||
      (noDia.includes('1 tieng') && (noDia.includes('giam') || noDia.includes('nua gia') || noDia.includes('dung 1 tieng') || noDia.includes('duoc khong') || noDia.includes('co duoc khong') || noDia.includes('co goi'))) ||
      ((noDia.includes('nghi gio') || noDia.includes('theo gio')) &&
        (noDia.includes('toi thieu') || noDia.includes('may tieng') || noDia.includes('2 gio') || noDia.includes('2h')))
    ) {
      const item = this.kb.getById('POLICY_MINIMUM_STAY_HOURLY');
      return {
        topic: 'HOURLY_BASE_2H',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ bên em áp dụng thời gian nghỉ giờ tối thiểu 2 tiếng, không có gói riêng 1 tiếng ạ. Khách sạn sẽ tính trọn gói 2 giờ đầu theo biểu giá niêm yết của phòng ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#scope.minimum_hourly_duration'],
        requires_staff_verification: false,
      };
    }

    // 2. Extra Hours 3h or 4h Calculation Basis (Topic 2)
    if (
      noDia.includes('3 hoac 4') ||
      noDia.includes('3 tieng') ||
      noDia.includes('4 tieng') ||
      noDia.includes('thue them gio') ||
      noDia.includes('o them gio')
    ) {
      if (noDia.includes('tinh the nao') || noDia.includes('tinh tien the nao') || noDia.includes('gia the nao') || noDia.includes('tinh sao')) {
        const item = this.kb.getById('POLICY_EXTRA_HOURS_CALCULATION');
        return {
          topic: 'EXTRA_HOURS_CALCULATION',
          matched_items: item ? [item] : [],
          answer_text: 'Dạ khi thuê 3 hoặc 4 tiếng, chi phí sẽ gồm giá gói 2 giờ đầu cộng thêm tiền phụ thu giờ phát sinh (mỗi giờ tiếp theo tính theo đơn giá giờ phát sinh của phòng, mặc định từ 100.000đ/giờ) ạ.',
          verification_status: 'CONFIRMED',
          source_citations: ['j_collection_dataset.json#quy_dinh.phu_thu_gio'],
          requires_staff_verification: false,
        };
      }
    }

    // 3. Weekday vs Weekend Daytime Pricing (Topic 3 - Restored)
    if (
      ((noDia.includes('ngay thuong') || noDia.includes('trong tuan') || noDia.includes('thu 2') || noDia.includes('thu hai')) &&
        (noDia.includes('cuoi tuan') || noDia.includes('thu 7') || noDia.includes('chu nhat') || noDia.includes('t7') || noDia.includes('cn'))) ||
      (noDia.includes('cuoi tuan') && (noDia.includes('tang gia') || noDia.includes('gia khac') || noDia.includes('dat hon') || noDia.includes('chenh lech') || noDia.includes('ap dung the nao'))) ||
      (noDia.includes('gia') && noDia.includes('cuoi tuan') && noDia.includes('ngay thuong'))
    ) {
      const item = this.kb.getById('POLICY_WEEKDAY_VS_WEEKEND');
      return {
        topic: 'WEEKDAY_VS_WEEKEND',
        matched_items: item ? [item] : [],
        answer_text:
          'Dạ tại cơ sở Jacayl Hà Đông, khung giờ ban ngày (08:00 - 18:00) áp dụng biểu giá riêng cho ngày thường và cuối tuần: ' +
          'ngày thường (Thứ 2 đến Thứ 6) Standard từ 159.000đ/2h, Deluxe 279.000đ/2h, Suite 399.000đ/2h; ' +
          'cuối tuần (Thứ 7 & Chủ Nhật) Standard là 180.000đ/2h, Deluxe 279.000đ/2h, Suite 449.000đ/2h ạ. ' +
          'Tại các cơ sở khác (Trần Khát Chân và J Village), giá phòng giữ nguyên theo biểu giá niêm yết đồng nhất không phân biệt ngày thường hay cuối tuần ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#facilities.jacayl-ha-dong.daytime_rates'],
        requires_staff_verification: false,
      };
    }

    // 4. Daytime 18:00 Boundary & Lock-in Price (Topic 4 - Restored)
    if (
      (noDia.includes('18h') && (noDia.includes('17h') || noDia.includes('truoc') || noDia.includes('sau') || noDia.includes('ranh gioi') || noDia.includes('moc'))) ||
      (noDia.includes('18:00') && (noDia.includes('17:00') || noDia.includes('truoc') || noDia.includes('sau') || noDia.includes('ranh gioi') || noDia.includes('moc'))) ||
      (noDia.includes('17h') && noDia.includes('qua 18h')) ||
      (noDia.includes('17:00') && noDia.includes('qua 18:00')) ||
      (noDia.includes('17h') && noDia.includes('18h')) ||
      (noDia.includes('17:00') && noDia.includes('18:00')) ||
      (noDia.includes('check in 17') && noDia.includes('18')) ||
      noDia.includes('khoa gia') ||
      noDia.includes('tai sao gia 17')
    ) {
      const item = this.kb.getById('POLICY_DAYTIME_18H_BOUNDARY');
      return {
        topic: 'DAYTIME_18H_BOUNDARY',
        matched_items: item ? [item] : [],
        answer_text:
          'Dạ theo quy định Business Policy V1.4.3: Khung giá ban ngày kết thúc lúc 18:00. ' +
          'Đơn giá gói 2 giờ đầu được xác định cố định theo thời điểm nhận phòng (CHECKIN_TIMESTAMP) và giữ nguyên trong suốt thời gian lưu trú (KEEP_CHECKIN_BASE_PRICE). ' +
          'Do đó, khách nhận phòng trước 18:00 (ví dụ lúc 17:00) được giữ nguyên đơn giá ban ngày cho 2 giờ đầu dù ở vắt qua sau 18:00, không bị đổi giá; ' +
          'khách nhận phòng từ 18:00 trở đi sẽ áp dụng giá theo biểu giá sau 18h trong dữ liệu phòng ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#scope.cross_window_behavior'],
        requires_staff_verification: false,
      };
    }

    // 5. Holiday Pricing - OWNER CONFIRMED V1.4.3: NO SURCHARGE (Topic 5)
    if (
      noDia.includes('ngay le') ||
      noDia.includes('le tet') ||
      noDia.includes('tet') ||
      noDia.includes('30/4') ||
      noDia.includes('1/5') ||
      noDia.includes('giang sinh') ||
      noDia.includes('noel') ||
      noDia.includes('14/2') ||
      noDia.includes('valentine') ||
      noDia.includes('8/3') ||
      noDia.includes('20/10')
    ) {
      const item = this.kb.getById('POLICY_HOLIDAY_PRICING');
      return {
        topic: 'HOLIDAY_PRICING',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ J Collection không tăng giá riêng vào ngày lễ hoặc ngày đặc biệt. Giá áp dụng theo biểu giá thông thường của cơ sở, ngày và giờ nhận phòng ạ. Khách sạn không có phụ thu ngày lễ hay tự động tăng giá phòng nhé ạ!',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#holiday_policy'],
        requires_staff_verification: false,
      };
    }

    // 4. Third Person Surcharge - UNKNOWN (Topic 13)
    if (
      noDia.includes('nguoi thu ba') ||
      noDia.includes('nguoi thu 3') ||
      noDia.includes('o 3 nguoi') ||
      noDia.includes('o 4 nguoi') ||
      noDia.includes('them nguoi')
    ) {
      const item = this.kb.getById('REGISTRY_THIRD_PERSON_SURCHARGE_UNKNOWN');
      return {
        topic: 'THIRD_PERSON_SURCHARGE',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ các phòng tại J Collection được thiết kế tiêu chuẩn cho 2 người lớn ạ. Hiện tại hệ thống chưa có quy định chính thức về mức phụ thu khi ở thêm người thứ ba, anh/chị vui lòng liên hệ trực tiếp lễ tân cơ sở để được các bạn hỗ trợ xác nhận nhé ạ!',
        verification_status: 'UNKNOWN',
        source_citations: ['UNVERIFIED_IN_DATASET'],
        requires_staff_verification: true,
      };
    }

    // 5. Discount Vouchers / Promotions - UNKNOWN (Topic 15)
    if (
      noDia.includes('voucher') ||
      noDia.includes('giam gia') ||
      noDia.includes('khuyen mai') ||
      noDia.includes('uu dai') ||
      noDia.includes('ma giam')
    ) {
      const item = this.kb.getById('REGISTRY_DISCOUNT_VOUCHER_UNCONFIRMED');
      return {
        topic: 'DISCOUNT_VOUCHER_POLICY',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ hiện tại J Collection áp dụng đồng bộ theo biểu phí niêm yết của hệ thống và chưa có chương trình voucher giảm giá tự động do chatbot cấp ạ. Mọi chính sách ưu đãi chính thức sẽ được thông báo trực tiếp qua fanpage hoặc website đặt phòng của khách sạn ạ!',
        verification_status: 'UNKNOWN',
        source_citations: ['UNVERIFIED_IN_DATASET'],
        requires_staff_verification: false,
      };
    }

    // 6. Overnight Hours & 20-min Early Grace - OWNER CONFIRMED V1.4.3 (Topic 7)
    if (
      (noDia.includes('qua dem') && (noDia.includes('gio') || noDia.includes('may gio') || noDia.includes('khung gio') || noDia.includes('check in') || noDia.includes('check out') || noDia.includes('tu may gio'))) ||
      noDia.includes('vao som 20 phut') ||
      noDia.includes('nhan som 20 phut') ||
      noDia.includes('21h40') ||
      noDia.includes('21:40')
    ) {
      const item = this.kb.getById('POLICY_OVERNIGHT_HOURS');
      return {
        topic: 'OVERNIGHT_HOURS',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ khung giờ nghỉ qua đêm chính thức tại J Collection là từ 22:00 hôm trước đến 12:00 trưa hôm sau ạ. Khách sạn có chính sách hỗ trợ nhận phòng sớm tối đa 20 phút (từ 21:40) vẫn áp dụng trọn gói giá qua đêm ạ. Nếu khách muốn nhận phòng trước 21:40 và ở qua đêm đến trưa mai thì bên em sẽ áp dụng theo giá gói Ngày Đêm (14:00 - 12:00 hôm sau) nhé ạ!',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#stay_package_eligibility.overnight'],
        requires_staff_verification: false,
      };
    }

    // 7. Day-Night Hours (Topic 8)
    if ((noDia.includes('ngay dem') || noDia.includes('theo ngay')) && (noDia.includes('gio') || noDia.includes('khung gio') || noDia.includes('check in') || noDia.includes('check out'))) {
      const item = this.kb.getById('POLICY_DAILY_HOURS');
      return {
        topic: 'DAILY_HOURS',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ khung giờ nghỉ theo ngày (ngày đêm) tại J Collection bắt đầu từ 14:00 hôm trước đến 12:00 trưa hôm sau ạ. Khách muốn check-in trước 20:30 (hoặc trước 21:40) và ở qua đêm đến hôm sau sẽ được tư vấn theo gói Ngày Đêm này ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#stay_package_eligibility.day_night'],
        requires_staff_verification: false,
      };
    }

    // 8. Early Morning Hourly before 08:00 - OWNER CONFIRMED V1.4.3 (Topic 5)
    if (noDia.includes('truoc 8h') || noDia.includes('truoc 08:00') || noDia.includes('4h sang') || noDia.includes('5h sang') || noDia.includes('6h sang') || noDia.includes('7h sang')) {
      const item = this.kb.getById('POLICY_EARLY_MORNING_PRICING');
      return {
        topic: 'EARLY_MORNING_PRICING',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ khung giá ban ngày của Jacayl Hà Đông chỉ áp dụng từ 08:00 đến trước 18:00 ạ. Với khung giờ nhận phòng sáng sớm trước 08:00, khách sạn áp dụng theo giá gốc nghỉ giờ niêm yết trong dữ liệu phòng (phòng Standard từ 159.000đ/2h, Deluxe từ 279.000đ/2h, Concept 101 là 399.000đ/2h) ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#facilities.jacayl-ha-dong.time_windows.early_morning'],
        requires_staff_verification: false,
      };
    }

    // 9. Overtime Policy after 10 minutes (From Minute 11) & Actual Checkout Billing Refusal (Topic 9 & 10)
    if (
      noDia.includes('qua gio') ||
      noDia.includes('phu thu') ||
      noDia.includes('lo 15 phut') ||
      noDia.includes('10 phut') ||
      noDia.includes('10p') ||
      noDia.includes('cho tre') ||
      noDia.includes('tre bao nhieu') ||
      noDia.includes('tre toi da') ||
      noDia.includes('tra muon') ||
      noDia.includes('muon gio') ||
      query.includes('muộn') ||
      noDia.includes('11 phut')
    ) {
      // Check if user is asking for actual checkout calculation
      if (
        noDia.includes('tinh cho toi') ||
        noDia.includes('tinh tien giup') ||
        noDia.includes('tinh giup') ||
        noDia.includes('tinh tien') ||
        noDia.includes('hoa don') ||
        noDia.includes('phai tra bao nhieu') ||
        noDia.includes('tinh phu thu checkout')
      ) {
        return {
          topic: 'CHECKOUT_BILLING_REQUEST',
          matched_items: [],
          answer_text: 'Dạ em có thể giải thích quy định tính giờ phát sinh của khách sạn, tuy nhiên việc tính toán và chốt hóa đơn phụ thu thực tế khi trả phòng do bộ phận lễ tân tại quầy trực tiếp đối soát và xuất hóa đơn ạ. Anh/chị vui lòng liên hệ trực tiếp lễ tân đang trực ca để được hỗ trợ kiểm tra chính xác nhé ạ!',
          verification_status: 'CONFIRMED',
          source_citations: ['j_collection_dataset.json#quy_dinh.phu_thu_gio'],
          requires_staff_verification: true,
        };
      }

      const item = this.kb.getById('POLICY_OVERTIME_10MIN');
      return {
        topic: 'OVERTIME_10MIN_POLICY',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ sau 10p bên em tính giờ tiếp theo ạ. Theo quy định chính thức của J Collection: Trễ đúng 10 phút chưa vượt ngưỡng; bắt đầu từ phút thứ 11 thuộc ngưỡng tính thêm 1 giờ phát sinh theo đơn giá giờ phát sinh của phòng (mặc định từ 100.000đ/giờ, một số phòng đặc biệt có mức riêng) ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json#overtime_grace_policy'],
        requires_staff_verification: false,
      };
    }

    // 10. Pet Policy (Topic 11)
    if (noDia.includes('thu cung') || noDia.includes('cho meo') || noDia.includes('mang cho') || noDia.includes('mang meo') || noDia.includes('pet')) {
      const item = this.kb.getById('REGISTRY_PET_POLICY_UNKNOWN');
      return {
        topic: 'PET_POLICY',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ hiện tại trên hệ thống dữ liệu chưa có quy định chính thức về việc cho phép mang thú cưng vào phòng nghỉ ạ. Để đảm bảo không ảnh hưởng đến trải nghiệm lưu trú, anh/chị vui lòng liên hệ trực tiếp với quầy lễ tân cơ sở trước khi đặt phòng để được nhân viên xác nhận cụ thể nhé ạ!',
        verification_status: 'UNKNOWN',
        source_citations: ['UNVERIFIED_IN_DATASET'],
        requires_staff_verification: true,
      };
    }

    // 11. Smoking Policy (Topic 12)
    if (noDia.includes('hut thuoc') || noDia.includes('thuoc la') || noDia.includes('vape')) {
      const item = this.kb.getById('REGISTRY_SMOKING_POLICY_UNKNOWN');
      return {
        topic: 'SMOKING_POLICY',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ hiện tại trên hệ thống chưa có thông tin xác nhận chính thức về quy định hút thuốc trong phòng ạ. Để giữ không gian chung luôn thông thoáng, anh/chị vui lòng trao đổi trực tiếp với lễ tân cơ sở để được hướng dẫn khu vực hút thuốc phù hợp nhé ạ!',
        verification_status: 'UNKNOWN',
        source_citations: ['UNVERIFIED_IN_DATASET'],
        requires_staff_verification: true,
      };
    }

    // 14. Parking Policy (Strict Ground Truth: quy_dinh.do_xe = "Có chỗ đỗ xe.")
    if (noDia.includes('do xe') || noDia.includes('dau xe') || noDia.includes('gui xe') || noDia.includes('o to') || noDia.includes('oto') || noDia.includes('xe may')) {
      const feeItem = this.kb.getById('REGISTRY_PARKING_FEE_UNCONFIRMED');
      const answer = 'Dạ bên em có chỗ đỗ xe ạ.';

      return {
        topic: 'PARKING_POLICY',
        matched_items: feeItem ? [feeItem] : [],
        answer_text: answer,
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_dataset.json#quy_dinh.do_xe'],
        requires_staff_verification: false,
      };
    }

    // 13. Cancellation & Refund (Topic 16)
    if (noDia.includes('huy phong') || noDia.includes('hoan tien') || noDia.includes('tra lai coc') || noDia.includes('doi lich')) {
      const item = this.kb.getById('POLICY_CANCELLATION_REFUND');
      return {
        topic: 'CANCELLATION_REFUND_POLICY',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ chính sách hủy phòng, đổi lịch hoặc hoàn tiền tại J Collection do nhân viên lễ tân trực tiếp tiếp nhận và xử lý theo từng trường hợp cụ thể ạ, chatbot không trực tiếp thực hiện nghiệp vụ này. Anh/chị vui lòng liên hệ trực tiếp hotline lễ tân cơ sở để được hỗ trợ nhanh nhất nhé ạ!',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_dataset.json#quy_dinh.huy_phong'],
        requires_staff_verification: true,
      };
    }

    // 14. Projector Amenity Inquiry (Topic 17)
    if (noDia.includes('may chieu') || noDia.includes('chieu phim') || noDia.includes('projector')) {
      const item = this.kb.getById('REGISTRY_AMENITY_PROJECTOR_UNCONFIRMED');
      return {
        topic: 'AMENITY_PROJECTOR',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ tiện nghi máy chiếu rạp phim hiện chưa có thông tin xác nhận chính thức trong danh sách tiện nghi website của các phòng ạ. Một số phòng có trang bị màn hình giải trí hoặc Smart TV, anh/chị vui lòng liên hệ lễ tân cơ sở để kiểm tra thiết bị máy chiếu thực tế tại phòng trước khi đặt nhé ạ!',
        verification_status: 'UNCONFIRMED',
        source_citations: ['j_collection_dataset.json#tien_nghi'],
        requires_staff_verification: true,
      };
    }

    // 15. Double Bathtub Amenity Inquiry (Topic 18)
    if (noDia.includes('bon tam doi') || noDia.includes('bon doi') || noDia.includes('jacuzzi doi')) {
      const item = this.kb.getById('REGISTRY_AMENITY_DOUBLE_BATHTUB_UNCONFIRMED');
      return {
        topic: 'AMENITY_DOUBLE_BATHTUB',
        matched_items: item ? [item] : [],
        answer_text: 'Dạ trong toàn hệ thống J Collection hiện có 5 phòng có bồn tắm nằm đã xác nhận (4 phòng tại J Village và phòng 1001 Đêm tại Trần Khát Chân) ạ. Tuy nhiên thông số kích thước bồn tắm đôi chưa được công bố chính thức trên website, anh/chị có thể liên hệ lễ tân cơ sở để được gửi ảnh và xác nhận kích thước bồn tắm chuẩn xác nhất nhé ạ!',
        verification_status: 'UNCONFIRMED',
        source_citations: ['j_collection_dataset.json#tien_nghi.bon_tam'],
        requires_staff_verification: true,
      };
    }

    // 15b. Jacuzzi / Whirlpool Tub Clarification (Topic 18b)
    if (
      (noDia.includes('bon suc') || noDia.includes('jacuzzi') || noDia.includes('suc massage')) &&
      !noDia.includes('bon tam doi') && !noDia.includes('bon doi')
    ) {
      return {
        topic: 'AMENITY_JACUZZI_WHIRLPOOL',
        matched_items: [],
        answer_text: 'Dạ theo thông tin chính thức trong dataset J Collection, toàn bộ các phòng có bồn tắm của bên em là **bồn tắm nằm ngâm thư giãn**, khách sạn **không có bồn sục Jacuzzi** (sục massage thủy lực) ạ. Các phòng có bồn tắm ngâm thư giãn hiện có tại J Village (phòng 201, 301, 401, 501) và Jacayl Trần Khát Chân (phòng 1001 Đêm) anh/chị nhé!',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_dataset.json#tien_nghi.bon_tam'],
        requires_staff_verification: false,
      };
    }

    // 16. Kitchen Amenity Inquiry (Topic 19)
    if (noDia.includes('bep') || noDia.includes('nau an') || noDia.includes('nau nuong')) {
      return {
        topic: 'AMENITY_KITCHEN',
        matched_items: [],
        answer_text: 'Dạ trên hệ thống dữ liệu hiện tại, các phòng tại J Collection chưa có thông tin xác nhận về trang bị bếp nấu trong phòng ạ. Anh/chị vui lòng liên hệ trực tiếp lễ tân cơ sở để được kiểm tra chính xác nhé ạ!',
        verification_status: 'UNKNOWN',
        source_citations: ['UNVERIFIED_IN_DATASET'],
        requires_staff_verification: true,
      };
    }

    // 17. Check-in/Check-out General Hours (Topic 20)
    if (noDia.includes('gio check in') || noDia.includes('gio check out') || noDia.includes('gio nhan phong') || noDia.includes('gio tra phong')) {
      return {
        topic: 'CHECKIN_CHECKOUT_GENERAL',
        matched_items: [],
        answer_text: 'Dạ về quy định giờ nhận và trả phòng tại J Collection như sau ạ:\n- **Nghỉ qua đêm**: Nhận phòng từ 22:00 (hỗ trợ nhận sớm tối đa từ 21:40), trả phòng trước 12:00 trưa hôm sau.\n- **Nghỉ theo ngày (ngày đêm)**: Nhận phòng từ 14:00, trả phòng trước 12:00 trưa hôm sau.\n- **Nghỉ theo giờ**: Linh hoạt theo khung giờ anh/chị đăng ký (tối thiểu gói 2 giờ đầu).\nQuá giờ sau 10 phút (từ phút thứ 11) sẽ bắt đầu tính thêm 1 giờ phát sinh theo quy định của khách sạn ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_business_policy_v1_4_3.json'],
        requires_staff_verification: false,
      };
    }

    // 18. Live Room Availability Inquiry (PMS Not Connected)
    if (
      noDia.includes('con phong khong') ||
      noDia.includes('dang trong khong') ||
      noDia.includes('con trong khong') ||
      noDia.includes('trong phong khong') ||
      noDia.includes('co phong khong') ||
      noDia.includes('qua luon') ||
      noDia.includes('con cho khong') ||
      noDia.includes('phong dang trong')
    ) {
      return {
        topic: 'LIVE_AVAILABILITY_INQUIRY',
        matched_items: [],
        answer_text: 'Dạ hiện tại hệ thống AI Concierge chưa kết nối với phần mềm quản lý phòng (PMS) theo thời gian thực nên em chưa thể xác nhận ngay phòng đang trống hay không ạ. Để kiểm tra chính xác tình trạng phòng trống thực tế và hỗ trợ giữ phòng ngay trước khi anh/chị qua, anh/chị vui lòng liên hệ trực tiếp hotline lễ tân của cơ sở nhé ạ!',
        verification_status: 'CONFIRMED',
        source_citations: ['ARCHITECTURE_V1_4_SCOPE#NO_PMS_DIRECT_INTEGRATION'],
        requires_staff_verification: true,
      };
    }

    // 22. Canonical Room Identity Policy: Room 601 Ha Dong is "50 — Sắc Thái", NOT "Tổng Thống"
    if (noDia.includes('tong thong') || noDia.includes('president')) {
      return {
        topic: 'CANONICAL_ROOM_IDENTITY_601',
        matched_items: [],
        answer_text: 'Dạ trong dữ liệu chính thức của J Collection, phòng 601 tại cơ sở Jacayl Hà Đông có tên thương mại chính thức là **50 — Sắc Thái** (hạng Concept, tính giá Suite) chứ không có tên "Tổng Thống" ạ. Phòng được trang bị bồn tắm nằm thư giãn và đầy đủ tiện nghi cao cấp ạ.',
        verification_status: 'CONFIRMED',
        source_citations: ['j_collection_dataset.json#jacayl-ha-dong.601-50-sac-thai'],
        requires_staff_verification: false,
      };
    }

    // 23. Canonical Room Identity Policy: Room 401 Ha Dong is NOT used for commercial business
    if (
      (noDia.includes('401') && (noDia.includes('ha dong') || facilityId === 'jacayl-ha-dong')) ||
      (noDia.includes('phong 401') && (noDia.includes('ha dong') || facilityId === 'jacayl-ha-dong'))
    ) {
      return {
        topic: 'NON_COMMERCIAL_ROOM_401_HA_DONG',
        matched_items: [],
        answer_text: 'Dạ phòng 401 tại cơ sở Jacayl Hà Đông hiện không sử dụng để kinh doanh (không nằm trong danh mục phòng đón khách của khách sạn) ạ. Tại Hà Đông, anh/chị có thể tham khảo các phòng khác như 402 — Whisky, 403 — Led Neon, 404 — Lolipop, 405 — 1st Time hoặc các căn phòng tuyệt đẹp khác trong danh mục của cơ sở nhé ạ!',
        verification_status: 'CONFIRMED',
        source_citations: ['OWNER_POLICY_V1_4_3#NON_COMMERCIAL_ROOM_401_HA_DONG'],
        requires_staff_verification: false,
      };
    }

    return null;
  }
}
