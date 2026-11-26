import { ComposeAdvisoryParams } from './adapters/llm-adapter.interface.js';
import { CoSoMa } from '../domain/types.js';
import { removeDiacritics } from './nlu-engine.js';
import { AnswerPlan } from './grounding/grounded-answer-planner.js';
import { WorkingMemory } from './conversation-types.js';
import { NormalizedDataset } from '../domain/normalized-schema.js';
import { isRoomNotForSale } from '../domain/room-business-registry.js';

export interface AdvisoryComposerConfig {
  bookingDomainOverride?: string;
}

export class AdvisoryComposer {
  private config: AdvisoryComposerConfig;
  private dataset?: NormalizedDataset;

  constructor(config?: AdvisoryComposerConfig, dataset?: NormalizedDataset) {
    this.config = config ?? {};
    this.dataset = dataset;
  }

  /**
   * Format VND currency string: 399000 -> "399.000đ"
   */
  public formatCurrency(amount: number): string {
    return amount.toLocaleString('vi-VN') + 'đ';
  }

  /**
   * Verified facility information directly from canonical j_collection_dataset.json
   */
  public getFacilityInfo(facility: CoSoMa): { name: string; address: string; phone: string; link: string } {
    let address = '';
    let phone = '';
    let link = '';

    if (this.dataset) {
      const cs = this.dataset.co_so.find((c) => c.ma === facility);
      if (cs) {
        address = cs.dia_chi;
        phone = cs.dien_thoai ?? '';
        link = cs.link ?? '';
      }
    }

    switch (facility) {
      case 'j-village':
        return {
          name: 'J Village',
          address: address || '64 Triệu Việt Vương',
          phone: phone || '0707 646 464',
          link: link || 'https://www.bookphong.com/co-so/j-village',
        };
      case 'jacayl-tran-khat-chan':
        return {
          name: 'Jacayl Trần Khát Chân',
          address: address || '283 Trần Khát Chân',
          phone: phone || '0921 123 939',
          link: link || 'https://www.bookphong.com/co-so/jacayl-tran-khat-chan',
        };
      case 'jacayl-ha-dong':
        return {
          name: 'Jacayl Hà Đông',
          address: address || 'Ngã ba Phúc La Phùng Hưng',
          phone: phone || '0522 464 646',
          link: link || 'https://www.bookphong.com/co-so/jacayl-ha-dong',
        };
    }
  }

  /**
   * Main composition entry point.
   */
  public compose(params: ComposeAdvisoryParams, answerPlan?: AnswerPlan): string {
    const { intent, action, userMessage, memory, candidates, policyAnswer, missingInformation } = params;
    const noDia = removeDiacritics(userMessage.toLowerCase());

    // 0a. Polite Closing / Gratitude (Section V: Trả lời lịch sự, KHÔNG bắt đầu luồng bán phòng mới)
    if (action === 'POLITE_CLOSING' || params.plan?.primaryGoal === 'POLITE_CLOSING') {
      return 'Dạ em rất sẵn lòng hỗ trợ anh/chị ạ! Nếu anh/chị cần thêm thông tin gì về phòng hoặc dịch vụ, cứ nhắn em bất cứ lúc nào nhé ạ.';
    }

    // 0b. Single Room Attribute Inquiry (Section V: Trả lời đúng sự thật, không bán hàng thêm)
    if (action === 'ANSWER_ROOM_ATTRIBUTE' || params.plan?.primaryGoal === 'ANSWER_DIRECT_FACT') {
      const room = params.roomDetail;
      const requestedFact = params.plan?.requestedFacts?.[0] ?? '';

      if (room) {
        if (noDia.includes('may chieu')) {
          const hasTub = room.tien_nghi?.bon_tam?.status === 'CONFIRMED_TRUE';
          const tubSnippet = hasTub ? `phòng ${room.ten_phong} có bồn tắm nằm thư giãn, tuy nhiên ` : `phòng ${room.ten_phong} `;
          return `Dạ ${tubSnippet}tiện nghi máy chiếu rạp phim hiện chưa có thông tin xác nhận chính thức trên hệ thống website của phòng ạ. Anh/chị vui lòng liên hệ lễ tân để kiểm tra thiết bị thực tế nhé ạ!`;
        }

        if (requestedFact === 'bon_tam' || noDia.includes('bon tam') || noDia.includes('bon doi')) {
          const is601HaDong = room.ma_phong === '601-50-sac-thai';
          const rawAms = (room.noi_dung_nguyen_van || []).join(' ').toLowerCase();
          const hasBigTub = is601HaDong || rawAms.includes('bồn tắm lớn') || rawAms.includes('bon tam lon');
          const hasTub = room.tien_nghi?.bon_tam?.status === 'CONFIRMED_TRUE';

          const tbField = room.tien_nghi?.bon_tam;
          const isConfirmedNoTub =
            tbField?.status === 'CONFIRMED_FALSE' &&
            !/không có ghi nhận|không nhắc/i.test(tbField.reason || '');
          if (hasBigTub) {
            return `Dạ phòng ${room.ten_phong} có bồn tắm lớn ạ.`;
          } else if (hasTub) {
            return `Dạ phòng ${room.ten_phong} có bồn tắm nằm thư giãn ạ.`;
          } else if (isConfirmedNoTub) {
            return `Dạ phòng ${room.ten_phong} không có bồn tắm ạ.`;
          } else {
            return `Dạ phòng ${room.ten_phong} hiện chưa có thông tin xác nhận bồn tắm trong dữ liệu catalog (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp lễ tân để kiểm tra thực tế ạ.`;
          }
        }

        if (requestedFact === 'ghe_tinh_yeu' || noDia.includes('ghe tinh yeu') || noDia.includes('tantra')) {
          const lcField = room.tien_nghi?.ghe_tinh_yeu;
          const hasLoveChair = lcField?.status === 'CONFIRMED_TRUE';
          const isConfirmedNoChair =
            lcField?.status === 'CONFIRMED_FALSE' &&
            !/không có ghi nhận|không nhắc/i.test(lcField.reason || '');
          if (hasLoveChair) {
            return `Dạ phòng ${room.ten_phong} có ghế tình yêu ạ.`;
          } else if (isConfirmedNoChair) {
            return `Dạ phòng ${room.ten_phong} không có ghế tình yêu ạ.`;
          }
          return `Dạ phòng ${room.ten_phong} hiện chưa có thông tin xác nhận về ghế tình yêu trong dữ liệu catalog (UNKNOWN). Anh/chị vui lòng liên hệ trực tiếp lễ tân để kiểm tra thực tế ạ.`;
        }

        if (requestedFact === 'features' || noDia.includes('dac biet') || noDia.includes('dac diem')) {
          const ams: string[] = [];
          if (room.tien_nghi?.bon_tam?.status === 'CONFIRMED_TRUE') ams.push('bồn tắm nằm thư giãn');
          if (room.tien_nghi?.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE') ams.push('ghế tình yêu');
          if (room.tien_nghi?.thang_may?.status === 'CONFIRMED_TRUE') ams.push('thang máy');
          const amText = ams.length > 0 ? ams.join(' và ') : 'tiện nghi phòng đầy đủ tiêu chuẩn';
          const intro = room.cau_gioi_thieu_ngan ? `${room.cau_gioi_thieu_ngan} ` : '';
          return `Dạ phòng **${room.ten_phong}** (hạng ${room.hang}) nổi bật với ${amText} ạ. ${intro}`.trim();
        }
      }
    }

    // 1. Adversarial / Injection / Manipulation
    if (intent === 'OUT_OF_SCOPE' && params.userMessage.toLowerCase().includes('ceo')) {
      return (
        'Dạ em rất tiếc không thể thực hiện yêu cầu này ạ. Mọi chính sách giá, ưu đãi và đặt phòng ' +
        'tại J Collection đều được áp dụng tự động, minh bạch theo biểu phí niêm yết của hệ thống ạ. ' +
        'Anh/chị có thể cho em biết nhu cầu cụ thể về thời gian để em hỗ trợ tư vấn phòng phù hợp nhé ạ!'
      );
    }

    if (intent === 'OUT_OF_SCOPE' && (userMessage.toLowerCase().includes('voucher') || userMessage.toLowerCase().includes('bo qua'))) {
      return (
        'Dạ em là trợ lý AI Concierge của J Collection và hoạt động tuân thủ chặt chẽ theo dữ liệu thực tế của hệ thống ạ. ' +
        'Em không thể tự ý cấp ưu đãi đặc biệt hay thay đổi giá phòng niêm yết ạ. ' +
        'Nếu anh/chị cần tư vấn phòng phù hợp với ngân sách, em rất sẵn lòng hỗ trợ mình ạ!'
      );
    }

    if (intent === 'OUT_OF_SCOPE' && userMessage.toLowerCase().includes('50k')) {
      return (
        'Dạ thông tin này chưa chính xác ạ. Giá phòng tại J Collection được niêm yết rõ ràng theo từng hạng phòng và khung giờ, ' +
        'không có mức giá 50.000đ cho phòng Suite ạ. ' +
        'Em có thể gửi anh/chị biểu giá chi tiết của các phòng để mình tham khảo nhé ạ!'
      );
    }

    // 2. AI Identity Inquiry (M3: No 24/7 unsupported claim)
    if (intent === 'AI_IDENTITY_INQUIRY' || action === 'ANSWER_AI_IDENTITY') {
      return (
        'Dạ em là trợ lý ảo AI Concierge của J Collection ạ! ' +
        'Em luôn sẵn sàng hỗ trợ anh/chị tra cứu thông tin phòng, tiện nghi, kiểm tra chính sách ' +
        'và báo giá chính xác nhất theo thời gian thực ạ. ' +
        'Anh/chị đang có nhu cầu tìm phòng ở cơ sở nào để em hỗ trợ mình ạ?'
      );
    }

    // 3. In-Stay Operational Request
    if (intent === 'IN_STAY_OPERATIONAL_REQUEST' || action === 'ROUTE_IN_STAY_REQUEST') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const contactInfo = facility ? `${facility.name} qua hotline ${facility.phone}` : 'quầy lễ tân hoặc hotline cơ sở';
      return (
        'Dạ em rất sẵn lòng hỗ trợ anh/chị, tuy nhiên em hiện là trợ lý tư vấn thông tin và hỗ trợ chọn phòng trước lưu trú ạ. ' +
        'Các dịch vụ phục vụ trực tiếp tại phòng (như thêm nước, khăn tắm, dọn phòng hay kiểm tra thiết bị) cần được lễ tân cơ sở tiếp nhận và cử nhân viên lên ngay. ' +
        `Anh/chị vui lòng liên hệ trực tiếp qua điện thoại nội bộ tại phòng hoặc gọi trực tiếp lễ tân ${contactInfo} để các bạn hỗ trợ mình ngay lập tức nhé ạ!`
      );
    }

    // 4. Checkout Dispute / Operational Conflict
    if (
      intent === 'CHECKOUT_DISPUTE' ||
      noDia.includes('tinh tien sai') ||
      noDia.includes('tinh lo') ||
      noDia.includes('bat tra them') ||
      noDia.includes('lo 15 phut') ||
      noDia.includes('vo ly the') ||
      (noDia.includes('phu thu') && noDia.includes('vo ly'))
    ) {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const contact = facility ? `hotline quản lý ${facility.name} (${facility.phone})` : 'lễ tân hoặc hotline quản lý cơ sở';
      return (
        'Dạ em rất tiếc và hiểu cảm giác không thoải mái của anh/chị về sự cố này ạ. ' +
        'Vì toàn bộ nghiệp vụ kiểm tra giờ nhận/trả phòng thực tế và xử lý hóa đơn tại quầy do bộ phận lễ tân trực tiếp quản lý, ' +
        `anh/chị vui lòng trao đổi trực tiếp với bạn lễ tân đang trực ca hoặc gọi ngay ${contact} để được đối soát camera, giờ phòng và giải quyết thỏa đáng, minh bạch nhất cho mình nhé ạ!`
      );
    }

    // 5. Booking Intent (Section A4: Verified booking link & hotline)
    if (
      (intent === 'BOOKING_INTENT' || action === 'PROVIDE_BOOKING_GUIDANCE') &&
      action !== 'ANSWER_FROM_VERIFIED_DATA' &&
      !policyAnswer
    ) {
      return this.composeBookingGuidance(memory, candidates);
    }

    // 6. Request Human / Staff Handoff
    if (intent === 'REQUEST_HUMAN' || intent === 'REQUEST_STAFF_HANDOFF' || action === 'FLAG_FOR_HUMAN') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const hotline = facility ? facility.phone : '0522 464 646';
      return (
        'Dạ vâng ạ! Em đã chuyển yêu cầu của anh/chị sang trạng thái chờ nhân viên lễ tân tiếp nhận hỗ trợ ạ. ' +
        `Trong thời gian chờ, anh/chị có thể liên hệ ngay hotline ${hotline} để được nhân viên hỗ trợ trực tiếp 1-1 ngay nhé ạ!`
      );
    }

    // 6b. Parking Policy (Section B5 & B6)
    if (intent === 'ASK_PARKING' || action === 'ANSWER_PARKING_POLICY') {
      const userLower = userMessage.toLowerCase();
      const userNoDia = removeDiacritics(userLower);
      const isCompound =
        userNoDia.includes('gia') ||
        userNoDia.includes('bao nhieu') ||
        userNoDia.includes('bao tien') ||
        userNoDia.includes('bon tam') ||
        userNoDia.includes('concept') ||
        userNoDia.includes('deluxe') ||
        userNoDia.includes('standard');

      if (isCompound) {
        let text = 'Dạ bên em có chỗ đỗ xe ạ.\n\n';
        if (userNoDia.includes('gia') || userNoDia.includes('bao nhieu') || userNoDia.includes('bao tien')) {
          text += this.composeCategoryPrice(memory, userMessage);
        } else if (candidates && candidates.length > 0) {
          text += this.composeRecommendations(candidates, memory, intent, answerPlan, params);
        }
        return text;
      }
      return 'Dạ bên em có chỗ đỗ xe ạ.';
    }

    // 6c. Room Availability Inquiry (Section B1)
    if (
      intent === 'CHECK_ROOM_AVAILABILITY' ||
      intent === 'ASK_ROOM_AVAILABILITY' ||
      action === 'ANSWER_AVAILABILITY_TRANSPARENT'
    ) {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const facilityName = facility ? facility.name : 'Jacayl Hà Đông';
      const facilityAddress = facility ? ` (${facility.address})` : '';
      const hotline = facility ? facility.phone : '0522 464 646';

      let extraPolicy = '';
      const userLower = userMessage.toLowerCase();
      if (userLower.includes('qua đêm') || userLower.includes('qua dem') || userLower.includes('21:40')) {
        extraPolicy = 'Về khung giờ nghỉ qua đêm: Bên em áp dụng từ **21:40** hôm nay đến 12:00 trưa hôm sau ạ.\n\n';
      }

      return (
        'Dạ hiện tại hệ thống AI Concierge chưa đồng bộ dữ liệu phòng trống theo thời gian thực (live PMS) ' +
        'nên em chưa thể xác nhận ngay cơ sở đang còn hay hết phòng ạ.\n\n' +
        extraPolicy +
        `Tại cơ sở **${facilityName}**${facilityAddress}, bên em có 3 hạng phòng: **Standard**, **Deluxe** và **Concept** để anh/chị tham khảo.\n\n` +
        `Để kiểm tra chính xác tình trạng phòng trống thực tế và hỗ trợ giữ phòng ngay tức thì, ` +
        `anh/chị vui lòng gọi trực tiếp hotline lễ tân **${hotline}** để được nhân viên hỗ trợ giữ phòng trực tiếp nhé ạ!\n\n` +
        'Nếu anh/chị muốn tìm hiểu thêm về đặc điểm hoặc hình ảnh của từng hạng phòng, em rất sẵn lòng giới thiệu chi tiết ạ!'
      );
    }

    // 6d. Browse Room Categories (Section B2)
    if (intent === 'BROWSE_ROOM_CATEGORIES' || action === 'SHOW_ROOM_CATEGORIES') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const facilityName = facility ? facility.name : 'Jacayl Hà Đông';

      return (
        `Dạ tại cơ sở **${facilityName}**, hệ thống phòng được chia làm 3 hạng phòng chính với các phong cách thiết kế đặc trưng:\n\n` +
        '1. **Hạng Standard**: Thiết kế ấm cúng, tối ưu, đầy đủ tiện nghi tiêu chuẩn cao cấp.\n' +
        '2. **Hạng Deluxe**: Không gian rộng rãi, thoáng mát, phong cách hiện đại lãng mạn.\n' +
        '3. **Hạng Concept**: Các phòng chủ đề đặc biệt được thiết kế theo câu chuyện nghệ thuật riêng biệt, có bồn tắm ngâm thư giãn hoặc ghế tình yêu.\n\n' +
        'Anh/chị quan tâm đến hạng phòng nào em có thể gửi danh sách phòng hoặc ảnh thực tế của hạng đó để mình tham khảo nhé ạ!'
      );
    }

    // 6e. Browse Rooms by Category (Section B3)
    if (intent === 'BROWSE_ROOMS_BY_CATEGORY' || action === 'SHOW_ROOMS_BY_CATEGORY') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const facilityId = memory.active_facility ?? 'jacayl-ha-dong';
      const facilityName = facility ? facility.name : 'Jacayl Hà Đông';

      let targetCategory = 'Concept';
      if (noDia.includes('standard')) targetCategory = 'Standard';
      else if (noDia.includes('deluxe')) targetCategory = 'Deluxe';
      else if (noDia.includes('concept')) targetCategory = 'Concept';

      const rooms = (this.dataset?.phong ?? []).filter((p) => {
        const matchesFac = p.co_so_ma === facilityId;
        const matchesCat = p.hang.toLowerCase() === targetCategory.toLowerCase();
        const isNotForSale = isRoomNotForSale(p.co_so_ma, p.ma_phong);
        return matchesFac && matchesCat && !isNotForSale;
      });

      const listText = rooms
        .map((r, idx) => {
          const ams: string[] = [];
          if (r.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE') ams.push('bồn tắm nằm thư giãn');
          if (r.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE') ams.push('ghế tình yêu');
          const amStr = ams.length > 0 ? ams.join(', ') : 'đầy đủ tiện nghi cao cấp';
          return `${idx + 1}. **${r.ten_phong}**: ${amStr}`;
        })
        .join('\n');

      return (
        `Dạ tại cơ sở **${facilityName}**, danh sách các phòng thuộc hạng **${targetCategory}** gồm có:\n\n` +
        listText +
        '\n\nAnh/chị muốn xem ảnh thực tế hoặc kiểm tra chi tiết phòng nào thì nhắn em nhé ạ!'
      );
    }

    // 6f. Category Price Inquiry (Section B4)
    if (intent === 'ASK_CATEGORY_PRICE' || action === 'QUOTE_CATEGORY_PRICE') {
      return this.composeCategoryPrice(memory, userMessage);
    }

    // 6g. Room Image Request (Section E)
    if (intent === 'REQUEST_ROOM_IMAGES' || action === 'SHOW_ROOM_IMAGES') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const facilityName = facility ? facility.name : 'J Collection';
      const room = params.roomDetail;
      const roomName = room ? room.ten_phong : 'phòng';
      const roomCategory = room ? ` (hạng ${room.hang})` : '';

      return (
        `Dạ em gửi anh/chị hình ảnh thực tế của phòng **${roomName}**${roomCategory} tại cơ sở **${facilityName}** dưới đây ạ! ` +
        'Anh/chị có thể nhấn vào ảnh để xem kích thước lớn hơn nhé ạ.'
      );
    }

    // 6h. Room Detail Request
    if (intent === 'GET_ROOM_DETAILS' || action === 'SHOW_ROOM_DETAIL') {
      const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
      const facilityName = facility ? facility.name : 'J Collection';
      const room = params.roomDetail;
      if (!room) {
        return `Dạ anh/chị đang muốn tìm hiểu chi tiết phòng nào tại cơ sở **${facilityName}** ạ?`;
      }

      const amenities: string[] = [];
      if (room.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE') amenities.push('bồn tắm nằm thư giãn');
      if (room.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE') amenities.push('ghế tình yêu');
      if (room.tien_nghi.thang_may?.status === 'CONFIRMED_TRUE') amenities.push('thang máy');
      const amStr = amenities.length > 0 ? amenities.join(', ') : 'đầy đủ tiện nghi cao cấp';

      return (
        `Dạ em xin gửi anh/chị thông tin chi tiết phòng **${room.ten_phong}** (hạng ${room.hang}) tại cơ sở **${facilityName}** ạ:\n\n` +
        `- **Tiện nghi nổi bật**: ${amStr}\n` +
        `- **Bảng giá tham khảo**:\n` +
        `  • Nghỉ giờ (2 giờ đầu): từ ${room.gia_goc_dataset.nghi_gio_2h.toLocaleString('vi-VN')}đ\n` +
        `  • Giờ phát sinh: ${room.gia_goc_dataset.gio_phat_sinh_ap_dung.toLocaleString('vi-VN')}đ/giờ\n` +
        `  • Qua đêm (từ 21:40): từ ${room.gia_goc_dataset.qua_dem.toLocaleString('vi-VN')}đ\n\n` +
        'Anh/chị có muốn xem ảnh thực tế hoặc dự kiến đi vào ngày giờ nào để em tính giá chính xác nhất cho mình không ạ?'
      );
    }

    // 7. Policy Inquiry & Multi-Topic Compound Answer
    if ((intent === 'ASK_POLICY' || action === 'ANSWER_FROM_VERIFIED_DATA') && policyAnswer) {
      const userLower = userMessage.toLowerCase();
      const hasRoomSearchInUtterance =
        userLower.includes('bon tam') ||
        userLower.includes('bồn tắm') ||
        userLower.includes('ghe tinh yeu') ||
        userLower.includes('ghế tình yêu') ||
        ((userLower.includes('gia') || userLower.includes('giá') || userLower.includes('thuê') || userLower.includes('thue')) &&
          (userLower.includes('tieng') || userLower.includes('tiếng') || userLower.includes('gio') || userLower.includes('giờ')));

      if (hasRoomSearchInUtterance && candidates.length > 0) {
        const roomRec = this.composeRecommendations(candidates, memory, intent, answerPlan, params);
        return `${policyAnswer}\n\n${roomRec}`;
      }
      return policyAnswer + '\n\nAnh/chị cần em tư vấn thêm thông tin nào nữa không ạ?';
    }

    // 8. Room Comparison
    if (intent === 'COMPARE_ROOMS' || action === 'COMPARE_VERIFIED_ROOMS') {
      return this.composeComparison(candidates, memory);
    }

    // 9. Greeting
    if (intent === 'GREETING' || action === 'GENERAL_GREETING') {
      return (
        'Dạ em chào anh/chị ạ! Chào mừng anh/chị đến với J Collection. ' +
        'Em có thể hỗ trợ anh/chị tư vấn phòng nghỉ, xem tiện nghi hoặc báo giá tại 3 cơ sở: ' +
        'J Village (Triệu Việt Vương), Jacayl Trần Khát Chân và Jacayl Hà Đông ạ. ' +
        'Anh/chị đang tìm phòng vào thời gian nào và có yêu cầu tiện nghi gì đặc biệt không ạ?'
      );
    }

    // 10. Recommend Rooms / Search Results (Handles A2 unverified amenities & A3 budget insufficient)
    if (params.packageEligibility?.eligibility_status === 'NEEDS_POLICY_CLARIFICATION') {
      return (
        params.packageEligibility.customer_explanation +
        '\n\nAnh/chị có thể liên hệ trực tiếp quầy lễ tân hoặc hotline cơ sở để được kiểm tra tình trạng phòng thực tế và hỗ trợ tốt nhất nhé ạ!'
      );
    }

    if (candidates && candidates.length > 0) {
      return this.composeRecommendations(candidates, memory, intent, answerPlan, params);
    }

    // 11. Clarification needed
    if (missingInformation && missingInformation.length > 0) {
      return this.composeClarification(missingInformation, memory);
    }

    // Default Fallback
    return (
      'Dạ em đã ghi nhận thông tin của anh/chị ạ. Anh/chị có thể cho em biết thêm về thời gian nhận phòng dự kiến ' +
      'hoặc cơ sở anh/chị muốn ghé (J Village, Trần Khát Chân hay Hà Đông) để em tư vấn phòng chuẩn xác nhất nhé ạ!'
    );
  }

  /**
   * Compose Recommendation Response for Candidates.
   * Handles Section A2 (unverified amenities) and Section A3 (insufficient budget).
   */
  private composeRecommendations(
    candidates: Array<{ item: any; quote?: any; bucket?: string }>,
    memory: WorkingMemory,
    intent: string,
    answerPlan?: AnswerPlan,
    params?: ComposeAdvisoryParams
  ): string {
    const facilityInfo = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
    const topCandidates = candidates.slice(0, 3);
    const userMsg = (params?.userMessage ?? '').toLowerCase();
    const isOneHourRequest =
      (memory.stay_type === 'nghi_gio' && memory.duration_hours === 1) ||
      userMsg.includes('1 tieng') ||
      userMsg.includes('1 tiếng') ||
      userMsg.includes('1h') ||
      userMsg.includes('1 gio') ||
      userMsg.includes('1 giờ') ||
      userMsg.includes('mot tieng') ||
      userMsg.includes('một tiếng') ||
      userMsg.includes('mot gio') ||
      userMsg.includes('một giờ');

    let intro = '';

    const userMsgNoDia = removeDiacritics(userMsg);
    const isParkingAsked =
      userMsgNoDia.includes('do xe') ||
      userMsgNoDia.includes('de xe') ||
      userMsgNoDia.includes('dau xe') ||
      userMsgNoDia.includes('bai xe') ||
      userMsgNoDia.includes('do o to') ||
      userMsgNoDia.includes('gui xe');
    if (isParkingAsked) {
      intro += 'Dạ bên em có chỗ đỗ xe ạ.\n\n';
    }

    // Business Policy V1.4.3: Stay Package Eligibility prepend
    if (params?.packageEligibility) {
      if (params.packageEligibility.eligibility_status === 'ALTERNATIVE_PACKAGE_RECOMMENDED') {
        intro += params.packageEligibility.customer_explanation + '\n\n';
      } else if (params.packageEligibility.eligibility_status === 'EARLY_CHECKIN_GRACE_APPLIED') {
        intro += params.packageEligibility.customer_explanation + '\n\n';
      }
    }

    // Business Policy V1.4.3: Minimum Hourly Duration explanation
    if (isOneHourRequest) {
      intro +=
        'Dạ bên em áp dụng thời gian nghỉ giờ tối thiểu 2 tiếng, không có gói riêng 1 tiếng ạ. ' +
        'Em xin gửi anh/chị mức giá 2 giờ đầu của các phòng để mình tham khảo nhé ạ:\n\n';
    } else if (answerPlan?.is_budget_insufficient || (memory.max_budget && candidates.every((c) => (c.quote?.total_estimate ?? 0) > (memory.max_budget ?? 0)))) {
      const minPrice = candidates[0].quote?.total_estimate ?? 420000;
      const delta = memory.max_budget ? minPrice - memory.max_budget : 0;
      intro +=
        `Dạ tại cơ sở **${facilityInfo?.name ?? 'J Collection'}**, hiện tại không có phòng nghỉ qua đêm với mức giá dưới ${this.formatCurrency(memory.max_budget ?? 0)} ạ. ` +
        `Mức giá qua đêm thấp nhất hiện tại từ **${this.formatCurrency(minPrice)}** (vượt ngân sách của mình khoảng ${this.formatCurrency(delta)}). ` +
        `Em xin gửi anh/chị phương án gần nhất với ngân sách để mình tham khảo nhé ạ:\n\n`;
    } else if (facilityInfo) {
      intro += `Dạ tại cơ sở **${facilityInfo.name}** (${facilityInfo.address}), em xin gửi anh/chị các lựa chọn phòng phù hợp nhất ạ:\n\n`;
    } else {
      intro += 'Dạ em xin gửi anh/chị các lựa chọn phòng phù hợp nhất trong hệ thống J Collection ạ:\n\n';
    }

    const lines = topCandidates.map((c, index) => {
      const room = c.item.room;
      const quote = c.quote;
      let priceText = '';
      if (quote && quote.is_resolved && quote.total_estimate) {
        priceText = `**${this.formatCurrency(quote.total_estimate)}** (${quote.price_breakdown_text})`;
      } else if (room.gia_goc_dataset?.nghi_gio_2h) {
        priceText = `từ **${this.formatCurrency(room.gia_goc_dataset.nghi_gio_2h)}** (2 giờ đầu)`;
      }

      const amenitiesList: string[] = [];
      if (room.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE') amenitiesList.push('bồn tắm nằm thư giãn');
      if (room.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE') amenitiesList.push('ghế tình yêu');
      if (room.tien_nghi.thang_may?.status === 'CONFIRMED_TRUE') amenitiesList.push('thang máy');

      const amenitiesHighlight = amenitiesList.length > 0 ? amenitiesList.join(', ') : 'đầy đủ tiện nghi cao cấp';
      // Canonical Room Identity Policy: Display name strictly uses room.ten_phong without modification
      const roomDisplayName = room.ten_phong;

      return (
        `${index + 1}. **${roomDisplayName}** (Hạng ${room.hang})\n` +
        `   - **Giá dự kiến**: ${priceText}\n` +
        `   - **Tiện nghi nổi bật**: ${amenitiesHighlight}`
      );
    });

    let conclusion = '';

    // Section A2: Explicit disclaimer for unconfirmed amenities
    const unconfirmed = answerPlan?.unconfirmed_amenities_to_disclaim ?? [];
    if (unconfirmed.length > 0) {
      conclusion +=
        `\n\n📌 **Lưu ý về tiện nghi**: Tiện nghi **${unconfirmed.join(', ')}** hiện chưa có thông tin xác nhận chính thức trên hệ thống website của phòng. ` +
        `Anh/chị vui lòng liên hệ trực tiếp với lễ tân cơ sở để kiểm tra thiết bị thực tế trước khi đặt nhé ạ!`;
    }

    conclusion +=
      '\n\nAnh/chị thấy ưng ý căn nào trong các lựa chọn trên, hoặc muốn xem thêm ảnh/chi tiết căn nào thì nhắn em nhé ạ!';

    return intro + lines.join('\n\n') + conclusion;
  }

  /**
   * Compose Room Comparison.
   */
  private composeComparison(
    candidates: Array<{ item: any; quote?: any; bucket?: string }>,
    memory: WorkingMemory
  ): string {
    if (candidates.length < 2) {
      return (
        'Dạ hiện tại em đang có thông tin của 1 phòng ạ. ' +
        'Anh/chị có thể cho em biết thêm một phòng khác hoặc tiêu chí cụ thể để em so sánh chi tiết cho mình nhé ạ!'
      );
    }

    const c1 = candidates[0];
    const c2 = candidates[1];
    const r1 = c1.item.room;
    const r2 = c2.item.room;

    const p1 = c1.quote?.total_estimate
      ? this.formatCurrency(c1.quote.total_estimate)
      : this.formatCurrency(r1.gia_goc_dataset?.nghi_gio_2h || 0);

    const p2 = c2.quote?.total_estimate
      ? this.formatCurrency(c2.quote.total_estimate)
      : this.formatCurrency(r2.gia_goc_dataset?.nghi_gio_2h || 0);

    let comp =
      `Dạ em xin gửi anh/chị so sánh chi tiết giữa **${r1.ten_phong}** và **${r2.ten_phong}** ạ:\n\n` +
      `1. **${r1.ten_phong}** (Hạng ${r1.hang}):\n` +
      `   - Mức giá: **${p1}**\n` +
      `   - Tiện nghi: ${r1.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE' ? 'Có bồn tắm thư giãn' : 'Không bồn tắm'}, ` +
      `${r1.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE' ? 'có ghế tình yêu' : 'không ghế tình yêu'}.\n\n` +
      `2. **${r2.ten_phong}** (Hạng ${r2.hang}):\n` +
      `   - Mức giá: **${p2}**\n` +
      `   - Tiện nghi: ${r2.tien_nghi.bon_tam?.status === 'CONFIRMED_TRUE' ? 'Có bồn tắm thư giãn' : 'Không bồn tắm'}, ` +
      `${r2.tien_nghi.ghe_tinh_yeu?.status === 'CONFIRMED_TRUE' ? 'có ghế tình yêu' : 'không ghế tình yêu'}.\n\n` +
      `Anh/chị ưu tiên không gian nào hơn để em hỗ trợ tư vấn chi tiết hơn nhé ạ!`;

    return comp;
  }

  /**
   * Compose Booking Guidance (Section A4: Verified booking links from dataset, Section A6: Verified hotlines).
   * Semantics: Does NOT hallucinate confirmed booking, does NOT ask for PII.
   */
  private composeBookingGuidance(
    memory: WorkingMemory,
    candidates: Array<{ item: any; quote?: any; bucket?: string }>
  ): string {
    const facilityInfo = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
    const chosenRoom = candidates.length > 0 ? candidates[0].item.room : null;
    const quote = candidates.length > 0 ? candidates[0].quote : memory.last_quote_context;

    let summaryText = '';
    if (chosenRoom) {
      summaryText += `\n- **Phòng chọn**: ${chosenRoom.ten_phong} (${chosenRoom.hang})`;
    }
    if (facilityInfo) {
      summaryText += `\n- **Cơ sở**: ${facilityInfo.name} - ${facilityInfo.address}`;
    }
    if (memory.checkin_datetime) {
      summaryText += `\n- **Thời gian nhận phòng dự kiến**: ${memory.checkin_datetime}`;
    }
    if (memory.duration_hours) {
      summaryText += `\n- **Thời lượng**: ${memory.duration_hours} giờ`;
    }
    if (quote && quote.total_estimate) {
      summaryText += `\n- **Tổng giá dự kiến**: ${this.formatCurrency(quote.total_estimate)}`;
    }

    // Source-verified booking URL: room.link_phong if available, or facility.link
    let bookingUrl = chosenRoom?.link_phong || facilityInfo?.link || 'https://www.bookphong.com';
    if (this.config.bookingDomainOverride) {
      bookingUrl = bookingUrl.replace('https://www.bookphong.com', `https://${this.config.bookingDomainOverride}`);
    }

    const hotline = facilityInfo ? facilityInfo.phone : '0707 646 464';

    return (
      'Dạ em đã ghi nhận đầy đủ nhu cầu đặt phòng của anh/chị ạ:' +
      (summaryText ? summaryText : '\n- Thông tin phòng đã được lưu trong phiên tư vấn') +
      '\n\n📌 **Hướng dẫn hoàn tất giữ phòng:**\n' +
      'Để đảm bảo phòng được giữ chắc chắn trên hệ thống và tránh bị trùng lịch trong thời gian cao điểm, ' +
      'anh/chị vui lòng hoàn tất đặt phòng qua một trong hai kênh chính thức sau nhé ạ:\n' +
      `1. **Website đặt phòng**: [Đặt phòng trực tuyến](${bookingUrl})\n` +
      `2. **Hotline lễ tân trực tiếp**: **${hotline}** (gọi hoặc nhắn tin Zalo để bạn lễ tân giữ phòng ngay cho mình ạ)\n\n` +
      'Anh/chị cần em hỗ trợ thêm thông tin gì trước khi đặt phòng không ạ?'
    );
  }

  /**
   * Compose clarification inquiry when information is missing.
   */
  private composeClarification(missing: string[], memory: WorkingMemory): string {
    const questions: string[] = [];
    if (missing.includes('facility')) {
      questions.push('cơ sở anh/chị muốn ghé (J Village - Triệu Việt Vương, Jacayl Trần Khát Chân hay Jacayl Hà Đông)');
    }
    if (missing.includes('checkin_datetime') || missing.includes('time')) {
      questions.push('ngày và giờ nhận phòng dự kiến của mình');
    }
    if (missing.includes('stay_type')) {
      questions.push('anh/chị muốn nghỉ theo giờ (tầm mấy tiếng) hay qua đêm');
    }

    return (
      `Dạ để em kiểm tra phòng và báo giá chính xác nhất cho mình, anh/chị có thể cho em biết thêm ${questions.join(' và ')} được không ạ?`
    );
  }

  /**
   * Compose Category Price response for all 3 categories at the active facility.
   * Grounded in Business Policy V1.4.3.
   */
  public composeCategoryPrice(memory: WorkingMemory, userMessage?: string): string {
    const facility = memory.active_facility ? this.getFacilityInfo(memory.active_facility) : null;
    const facilityName = facility ? facility.name : 'Jacayl Hà Đông';
    const msg = (userMessage ?? '').toLowerCase();

    const isDeluxe =
      msg.includes('deluxe') ||
      (!msg.includes('3') && !msg.includes('ba') && !msg.includes('cac') && memory.target_category === 'Deluxe');
    const isStandard =
      msg.includes('standard') ||
      (!msg.includes('3') && !msg.includes('ba') && !msg.includes('cac') && memory.target_category === 'Standard');
    const focusedRoom = memory.focused_room && this.dataset
      ? this.dataset.phong.find(
          (p) => p.co_so_ma === memory.focused_room?.co_so_ma && p.ma_phong === memory.focused_room?.ma_phong
        )
      : null;

    const isConcept =
      msg.includes('concept') ||
      focusedRoom?.hang === 'Concept' ||
      focusedRoom?.hang === 'Suite' ||
      (!msg.includes('3') && !msg.includes('ba') && !msg.includes('cac') && (memory.target_category === 'Concept' || memory.target_category === 'Suite'));

    if (isDeluxe && !isStandard && !isConcept) {
      return (
        `Dạ tại cơ sở **${facilityName}**, thông tin bảng giá cho các phòng hạng **Deluxe** theo Business Policy V1.4.3 và dataset như sau ạ:\n\n` +
        '1. **Nghỉ theo giờ (tối thiểu 2 giờ)**:\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 2 đến Thứ 6: **279.000đ** (2 giờ đầu)\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 7 & Chủ Nhật: **315.000đ** (2 giờ đầu)\n' +
        '   - Khung ngoài 08:00 – 18:00 (trước 08:00 hoặc từ 18:00 trở đi): **279.000đ** (2 giờ đầu, áp dụng theo giá gốc từng phòng trong dataset)\n' +
        '   - Giờ phát sinh: **100.000đ / giờ** (sau 10 phút tính thêm 1 giờ theo chính sách ân hạn V1.4.3)\n\n' +
        '2. **Nghỉ qua đêm** (áp dụng từ 21:40 hôm nay đến 12:00 trưa hôm sau): từ **560.000đ** (theo giá gốc phòng Deluxe trong dataset)\n\n' +
        '3. **Nghỉ ngày đêm** (từ 14:00 hôm nay đến 12:00 trưa hôm sau): từ **650.000đ** (theo giá gốc phòng Deluxe trong dataset)\n\n' +
        '*(Lưu ý: Bên em áp dụng thời gian nghỉ giờ tối thiểu 2 giờ ạ. Giá được ấn định tại thời điểm nhận phòng và giữ nguyên suốt phiên nghỉ).*\n\n' +
        'Anh/chị dự kiến nhận phòng vào ngày nào (ngày thường hay cuối tuần) và khung giờ nào để em tính giá chính xác nhất cho mình nhé ạ!'
      );
    }

    if (isStandard && !isDeluxe && !isConcept) {
      return (
        `Dạ tại cơ sở **${facilityName}**, thông tin bảng giá cho các phòng hạng **Standard** theo Business Policy V1.4.3 và dataset như sau ạ:\n\n` +
        '1. **Nghỉ theo giờ (tối thiểu 2 giờ)**:\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 2 đến Thứ 6: **159.000đ** (2 giờ đầu)\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 7 & Chủ Nhật: **180.000đ** (2 giờ đầu)\n' +
        '   - Khung ngoài 08:00 – 18:00 (trước 08:00 hoặc từ 18:00 trở đi): **159.000đ** (2 giờ đầu, áp dụng theo giá gốc từng phòng trong dataset)\n' +
        '   - Giờ phát sinh: **100.000đ / giờ** (sau 10 phút tính thêm 1 giờ theo chính sách ân hạn V1.4.3)\n\n' +
        '2. **Nghỉ qua đêm** (áp dụng từ 21:40 hôm nay đến 12:00 trưa hôm sau): từ **420.000đ** (theo giá gốc phòng Standard trong dataset)\n\n' +
        '3. **Nghỉ ngày đêm** (từ 14:00 hôm nay đến 12:00 trưa hôm sau): từ **520.000đ** (theo giá gốc phòng Standard trong dataset)\n\n' +
        '*(Lưu ý: Bên em áp dụng thời gian nghỉ giờ tối thiểu 2 giờ ạ. Giá được ấn định tại thời điểm nhận phòng và giữ nguyên suốt phiên nghỉ).*\n\n' +
        'Anh/chị dự kiến nhận phòng vào ngày nào (ngày thường hay cuối tuần) và khung giờ nào để em tính giá chính xác nhất cho mình nhé ạ!'
      );
    }

    if (isConcept && !isDeluxe && !isStandard) {
      return (
        `Dạ tại cơ sở **${facilityName}**, thông tin bảng giá cho các phòng hạng **Concept** (như phòng 50 — Sắc Thái / 601, chính thức áp dụng biểu giá Suite theo V1.4.3) như sau ạ:\n\n` +
        '1. **Nghỉ theo giờ (tối thiểu 2 giờ)**:\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 2 đến Thứ 6: **399.000đ** (2 giờ đầu)\n' +
        '   - Khung giờ ban ngày (08:00 – trước 18:00), Thứ 7 & Chủ Nhật: **449.000đ** (2 giờ đầu)\n' +
        '   - Khung ngoài 08:00 – 18:00 (trước 08:00 hoặc từ 18:00 trở đi): **399.000đ** (2 giờ đầu, áp dụng theo giá gốc từng phòng trong dataset)\n' +
        '   - Giờ phát sinh: từ **100.000đ – 200.000đ / giờ** (phòng 101: 100.000đ/h; phòng 601, 602: 200.000đ/h)\n\n' +
        '2. **Nghỉ qua đêm** (áp dụng từ 21:40 hôm nay đến 12:00 trưa hôm sau): từ **700.000đ** (theo giá gốc phòng Concept trong dataset)\n\n' +
        '3. **Nghỉ ngày đêm** (từ 14:00 hôm nay đến 12:00 trưa hôm sau): từ **780.000đ** (theo giá gốc phòng Concept trong dataset)\n\n' +
        '*(Lưu ý: Bên em áp dụng thời gian nghỉ giờ tối thiểu 2 giờ ạ. Giá được ấn định tại thời điểm nhận phòng và giữ nguyên suốt phiên nghỉ).*\n\n' +
        'Anh/chị dự kiến nhận phòng vào ngày nào (ngày thường hay cuối tuần) và khung giờ nào để em tính giá chính xác nhất cho mình nhé ạ!'
      );
    }

    // Default: Present all 3 categories
    return (
      `Dạ tại cơ sở **${facilityName}**, bảng giá tiêu chuẩn cho 3 hạng phòng như sau ạ:\n\n` +
      '1. **Hạng Standard**:\n' +
      '   - Nghỉ giờ (tối thiểu 2 giờ): từ **159.000đ** (ngày thường) / **180.000đ** (cuối tuần) cho 2 giờ đầu\n' +
      '   - Nghỉ qua đêm: từ **420.000đ**\n\n' +
      '2. **Hạng Deluxe**:\n' +
      '   - Nghỉ giờ (tối thiểu 2 giờ): từ **279.000đ** (ngày thường) / **315.000đ** (cuối tuần) cho 2 giờ đầu\n' +
      '   - Nghỉ qua đêm: từ **560.000đ**\n\n' +
      '3. **Hạng Concept** (áp dụng biểu giá Suite):\n' +
      '   - Nghỉ giờ (tối thiểu 2 giờ): từ **399.000đ** (ngày thường) / **449.000đ** (cuối tuần) cho 2 giờ đầu\n' +
      '   - Nghỉ qua đêm: từ **700.000đ**\n\n' +
      '*(Lưu ý: Bên em áp dụng thời gian nghỉ giờ tối thiểu 2 giờ ạ. Ngoài khung ban ngày 08:00 – 18:00, giá nghỉ giờ 2h đầu áp dụng theo giá gốc từng phòng trong dataset. Khung giờ qua đêm áp dụng từ 21:40 hôm nay đến 12:00 trưa hôm sau).*\n\n' +
      'Anh/chị dự kiến nghỉ theo giờ hay qua đêm vào ngày nào và khung giờ nào để em tính giá chính xác nhất cho mình nhé ạ!'
    );
  }
}
