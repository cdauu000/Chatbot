import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa, RawRoomCategory } from '../../domain/types.js';
import { WorkingMemory, ExtractedEntities } from '../conversation-types.js';
import { ConversationPlan, PlanningGoal, RequiredTool, ResponseDepth } from './conversation-plan.js';
import { RoomReferenceResolver } from '../reference-resolver.js';
import { removeDiacritics } from '../nlu-engine.js';
import { LLMAdapter } from '../adapters/llm-adapter.interface.js';

export interface PlannerOptions {
  llmAdapter?: LLMAdapter;
}

export class AIConversationPlanner {
  private dataset: NormalizedDataset;
  private referenceResolver: RoomReferenceResolver;
  private llmAdapter?: LLMAdapter;

  constructor(dataset: NormalizedDataset, options?: PlannerOptions) {
    this.dataset = dataset;
    this.referenceResolver = new RoomReferenceResolver(dataset);
    this.llmAdapter = options?.llmAdapter;
  }

  /**
   * Main entry point to plan conversational action.
   * Uses Hybrid Intelligence: Deterministic Fast Path -> Semantic Context Analysis -> Validated Plan.
   */
  public async plan(
    userMessage: string,
    memory: WorkingMemory,
    entities: ExtractedEntities,
    boundPropertyId?: CoSoMa,
    referenceClock?: string
  ): Promise<ConversationPlan> {
    const rawLower = userMessage.toLowerCase().trim();
    const noDia = removeDiacritics(rawLower);

    const effectiveFacility =
      entities.facility || memory.active_facility || boundPropertyId || null;

    // =========================================================================
    // 1. DETERMINISTIC FAST PATH (Zero latency, 100% deterministic guardrails)
    // =========================================================================

    // 1.1. Polite Closing / Gratitude (Section V: Trả lời lịch sự, KHÔNG bắt đầu luồng bán phòng mới)
    if (this.isPoliteClosing(rawLower, noDia)) {
      return {
        primaryGoal: 'POLITE_CLOSING',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: [],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: true,
        topicChanged: false,
        confidence: 0.99,
        reasoning: 'Khách hàng gửi lời cảm ơn / kết thúc lịch sự -> Trả lời ngắn, không chào bán phòng.',
      };
    }

    // 1.2. In-Stay Operational Request (Section B3 of M3/M4: In-stay refusal + front desk hotline)
    if (this.isInStayRequest(noDia)) {
      return {
        primaryGoal: 'IN_STAY_SERVICE_ROUTING',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['in_stay_service'],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: true,
        confidence: 0.99,
        reasoning: 'Yêu cầu phục vụ phòng trong lưu trú -> Từ chối khéo và hướng dẫn hotline lễ tân.',
      };
    }

    // 1.3. Checkout / Billing Dispute (Dispute handling -> manager hotline)
    if (this.isCheckoutDispute(noDia)) {
      return {
        primaryGoal: 'CHECKOUT_DISPUTE_ROUTING',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['dispute'],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: true,
        confidence: 0.99,
        reasoning: 'Khiếu nại giờ phòng hoặc tiền bạc -> Hướng dẫn đối soát cùng quản lý cơ sở.',
      };
    }

    // 1.4. Explicit Human Takeover Request (Handoff without unverified SLA promises)
    if (this.isHumanRequest(noDia)) {
      return {
        primaryGoal: 'REQUEST_STAFF_HANDOFF',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['staff_handoff'],
        requiredTools: ['STAFF_HANDOFF'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: true,
        confidence: 0.99,
        reasoning: 'Khách muốn gặp nhân viên / lễ tân -> Chuyển trạng thái WAITING_FOR_STAFF.',
      };
    }

    // 1.5. Pure Parking Inquiry (Section IV.1 Fast Path: "Dạ bên em có chỗ đỗ xe ạ.")
    if (this.isPureParkingInquiry(noDia)) {
      return {
        primaryGoal: 'ANSWER_POLICY',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['parking'],
        requiredTools: ['POLICY_LOOKUP'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: true,
        confidence: 0.98,
        reasoning: 'Hỏi chỗ đỗ xe độc lập -> Trả lời xác nhận trực tiếp, không mời chào phòng.',
      };
    }

    // 1.6. Adversarial / Jailbreak / Manipulation
    if (this.isAdversarialOrOutOfScope(rawLower, noDia)) {
      return {
        primaryGoal: 'DECLINE_OUT_OF_SCOPE',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: [],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: false,
        confidence: 0.95,
        reasoning: 'Yêu cầu ưu đãi đặc biệt / bỏ qua chính sách / mạo danh -> Từ chối lịch sự.',
      };
    }

    // 1.7. Pure General Greeting
    if (this.isPureGreeting(noDia)) {
      return {
        primaryGoal: 'POLITE_GREETING',
        secondaryGoals: [],
        planner_mode: 'deterministic_fast_path',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['greeting'],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: false,
        confidence: 0.95,
        reasoning: 'Lời chào đầu phiên -> Giới thiệu ngắn gọn và gợi mở nhu cầu.',
      };
    }

    // =========================================================================
    // 2. CONTEXTUAL ROOM & TOPIC REASONING (Semantic Context Layer)
    // =========================================================================

    // Resolve room reference in context
    const refResult = this.referenceResolver.resolve(userMessage, {
      ...memory,
      active_facility: effectiveFacility,
    });
    const resolvedRoom = refResult?.matched_room;
    const resolvedKey = refResult?.matched_key ?? memory.focused_room;

    // Check if focused room exists (either explicit in turn, or carried from memory)
    const activeRoom =
      resolvedRoom ??
      (resolvedKey
        ? this.dataset.phong.find(
            (p) => p.co_so_ma === resolvedKey.co_so_ma && p.ma_phong === resolvedKey.ma_phong
          )
        : undefined);

    const isContextualRoomReference =
      this.isPronominalRoomReference(noDia) ||
      (activeRoom !== undefined && (noDia.includes('phong nay') || noDia.includes('can nay') || noDia.includes('o day')));

    // 2.0. Specific Jacuzzi / Whirlpool Tub Inquiry (Clarification per canonical dataset)
    if (noDia.includes('jacuzzi') || noDia.includes('bon suc') || noDia.includes('suc massage')) {
      return {
        primaryGoal: 'ANSWER_POLICY',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['jacuzzi'],
        requiredTools: ['POLICY_LOOKUP'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: false,
        topicChanged: false,
        confidence: 0.97,
        reasoning: 'Khách hỏi bồn sục Jacuzzi -> Giải thích J Collection chỉ có bồn tắm nằm thư giãn, không có bồn Jacuzzi.',
      };
    }

    // 2.1. Direct Room Attribute / Amenity Inquiry on focused room (Section V Example: Bồn tắm đôi)
    if (this.isSpecificAmenityOrAttributeInquiry(noDia)) {
      const requestedFact = this.extractRequestedAmenityFact(noDia);

      return {
        primaryGoal: 'ANSWER_DIRECT_FACT',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: activeRoom ? activeRoom.co_so_ma : effectiveFacility,
        referencedRoomId: activeRoom ? activeRoom.ma_phong : undefined,
        referencedCategory: activeRoom ? activeRoom.hang : undefined,
        requestedFacts: [requestedFact],
        requiredTools: activeRoom ? ['ROOM_DETAIL_LOOKUP'] : ['POLICY_LOOKUP'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: activeRoom !== undefined,
        topicChanged: false,
        confidence: 0.94,
        reasoning: `Hỏi về đặc điểm cụ thể (${requestedFact}) của phòng -> Trả lời đúng sự thật trong dataset, không chèn danh sách phòng.`,
      };
    }

    // 2.2. Room Specific Features ("Phòng này có gì đặc biệt?")
    if (this.isRoomSpecialFeaturesInquiry(noDia)) {
      return {
        primaryGoal: 'ANSWER_DIRECT_FACT',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: activeRoom ? activeRoom.co_so_ma : effectiveFacility,
        referencedRoomId: activeRoom ? activeRoom.ma_phong : undefined,
        referencedCategory: activeRoom ? activeRoom.hang : undefined,
        requestedFacts: ['features'],
        requiredTools: ['ROOM_DETAIL_LOOKUP'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: activeRoom !== undefined,
        topicChanged: false,
        confidence: 0.95,
        reasoning: 'Hỏi đặc điểm phòng -> Trả lời tiện nghi xác nhận, không tự động báo giá hay chào phòng khác.',
      };
    }

    // 2.3. Request Photos ("Cho xem ảnh đi", "Có ảnh không?")
    if (this.isImageRequest(rawLower, noDia)) {
      return {
        primaryGoal: 'SHOW_MEDIA',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: activeRoom ? activeRoom.co_so_ma : effectiveFacility,
        referencedRoomId: activeRoom ? activeRoom.ma_phong : undefined,
        referencedCategory: activeRoom ? activeRoom.hang : undefined,
        requestedFacts: ['anh'],
        requiredTools: ['MEDIA_LOOKUP'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: activeRoom !== undefined,
        topicChanged: false,
        confidence: 0.96,
        reasoning: 'Khách muốn xem ảnh thực tế -> Gửi ảnh chính thức từ dataset, không chèn bảng giá.',
      };
    }

    // 2.3b. Inherited Timing Switch ("Loại hồi nãy nếu đổi sang tối thứ Bảy thì sao?")
    const isInheritedTimingChange =
      (noDia.includes('hoi nay') ||
        noDia.includes('luc nay') ||
        noDia.includes('ban nay') ||
        noDia.includes('loai truoc') ||
        noDia.includes('loai do') ||
        noDia.includes('phong truoc')) &&
      (noDia.includes('toi thu bay') ||
        noDia.includes('thu bay') ||
        noDia.includes('chu nhat') ||
        noDia.includes('doi sang') ||
        noDia.includes('sang toi'));

    if (isInheritedTimingChange) {
      const inheritedCategory = memory.target_category ?? activeRoom?.hang ?? 'Deluxe';
      return {
        primaryGoal: 'CALCULATE_PRICE',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: effectiveFacility,
        referencedCategory: inheritedCategory,
        referencedRoomId: activeRoom?.ma_phong,
        requestedFacts: ['price', 'weekend_evening'],
        requiredTools: activeRoom ? ['QUOTE_ROOM'] : ['QUOTE_CATEGORY'],
        needsClarification: false,
        responseDepth: 'normal',
        isFollowUp: true,
        topicChanged: false,
        confidence: 0.95,
        reasoning: `Kế thừa hạng phòng trước (${inheritedCategory}) và chuyển sang tính giá cho khung tối thứ Bảy.`,
      };
    }

    // 2.4. Room Price Inquiry / Follow-up Quote ("Giá bao nhiêu?", "Giá 4 tiếng thứ Bảy thế nào?")
    if (this.isPriceInquiry(noDia)) {
      const hasSpecificRoom = activeRoom !== undefined;
      const hasSpecificCategory = this.extractCategoryFromUtterance(noDia);
      const isCompoundParking =
        noDia.includes('do xe') ||
        noDia.includes('dau xe') ||
        noDia.includes('gui xe');

      const secondaryGoals: PlanningGoal[] = isCompoundParking ? ['ANSWER_POLICY'] : [];
      const requestedFacts = ['price'];
      if (hasSpecificCategory) requestedFacts.push('category_price');
      if (isCompoundParking) requestedFacts.push('parking');
      const requiredTools: RequiredTool[] = hasSpecificRoom
        ? ['QUOTE_ROOM']
        : ['QUOTE_CATEGORY'];
      if (isCompoundParking) requiredTools.push('POLICY_LOOKUP');

      if (hasSpecificRoom) {
        return {
          primaryGoal: 'CALCULATE_PRICE',
          secondaryGoals,
          planner_mode: 'semantic_context',
          referencedPropertyId: activeRoom.co_so_ma,
          referencedRoomId: activeRoom.ma_phong,
          referencedCategory: activeRoom.hang,
          requestedFacts,
          requiredTools,
          needsClarification: false,
          responseDepth: 'normal',
          isFollowUp: true,
          topicChanged: false,
          confidence: 0.95,
          reasoning: `Khách hỏi giá cho phòng đang thảo luận (${activeRoom.ten_phong}) -> Tính giá dựa trên phụ thu của phòng đó.`,
        };
      }

      if (hasSpecificCategory) {
        return {
          primaryGoal: 'CALCULATE_PRICE',
          secondaryGoals,
          planner_mode: 'semantic_context',
          referencedPropertyId: effectiveFacility,
          referencedCategory: hasSpecificCategory,
          requestedFacts,
          requiredTools,
          needsClarification: false,
          responseDepth: 'normal',
          isFollowUp: false,
          topicChanged: true,
          confidence: 0.92,
          reasoning: `Khách hỏi giá cho hạng phòng (${hasSpecificCategory})${isCompoundParking ? ' kèm hỏi chỗ đỗ xe' : ''} -> Báo biểu giá theo Business Policy V1.4.3.`,
        };
      }

      // General price question without room/category
      return {
        primaryGoal: 'CALCULATE_PRICE',
        secondaryGoals: isCompoundParking ? ['ANSWER_POLICY', 'CONSULT_AND_RECOMMEND'] : ['CONSULT_AND_RECOMMEND'],
        planner_mode: 'semantic_context',
        referencedPropertyId: effectiveFacility,
        requestedFacts: isCompoundParking ? ['general_price', 'parking'] : ['general_price'],
        requiredTools,
        needsClarification: true,
        clarificationReason: 'Chưa có thông tin hạng phòng hoặc ngày giờ cụ thể',
        responseDepth: 'normal',
        isFollowUp: false,
        topicChanged: false,
        confidence: 0.88,
        reasoning: 'Hỏi giá chung -> Cung cấp bảng giá tiêu chuẩn 3 hạng phòng và hỏi thời gian dự kiến.',
      };
    }

    // 2.5. Topic / Category Change ("À đổi sang Deluxe nhé", "Thôi không thuê phòng 601, xem phòng khác")
    if (this.isTopicOrCategoryChange(noDia)) {
      const isDecliningCurrentRoom =
        noDia.includes('thoi khong') ||
        noDia.includes('khong thue') ||
        noDia.includes('xem phong khac') ||
        noDia.includes('khong lay');

      const targetCategory = this.extractCategoryFromUtterance(noDia);

      return {
        primaryGoal: 'CONSULT_AND_RECOMMEND',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: effectiveFacility,
        referencedCategory: targetCategory ?? null,
        referencedRoomId: null, // Clear 601 focus
        requestedFacts: ['rooms_by_category'],
        requiredTools: ['SEARCH_ROOMS'],
        needsClarification: false,
        responseDepth: 'normal',
        isFollowUp: false,
        topicChanged: true,
        clearPreviousRequirements: isDecliningCurrentRoom, // Drops previous room lock
        confidence: 0.93,
        reasoning: isDecliningCurrentRoom
          ? 'Khách hủy chọn phòng đang xem và muốn tìm phòng khác -> Xóa phòng cũ, mở lại danh sách.'
          : `Khách đổi chủ đề / đổi sang hạng phòng (${targetCategory ?? 'mới'}) -> Xóa bỏ phòng cũ, tìm kiếm hạng mới.`,
      };
    }

    // 2.6. Resume Previous Topic ("Loại trước thì sao?", "Quay lại phòng ban nãy")
    if (this.isResumePreviousTopic(noDia)) {
      const prevRef = memory.recent_references && memory.recent_references.length > 1
        ? memory.recent_references[memory.recent_references.length - 2]
        : null;

      const prevRoom = prevRef
        ? this.dataset.phong.find((p) => p.co_so_ma === prevRef.key.co_so_ma && p.ma_phong === prevRef.key.ma_phong)
        : null;

      return {
        primaryGoal: prevRoom ? 'ANSWER_DIRECT_FACT' : 'CONSULT_AND_RECOMMEND',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: prevRoom?.co_so_ma ?? effectiveFacility,
        referencedRoomId: prevRoom?.ma_phong,
        referencedCategory: prevRoom?.hang,
        requestedFacts: ['resume_topic'],
        requiredTools: prevRoom ? ['ROOM_DETAIL_LOOKUP'] : ['SEARCH_ROOMS'],
        needsClarification: prevRoom === null,
        clarificationReason: prevRoom === null ? 'Không tìm thấy ngữ cảnh phòng trước đó' : undefined,
        responseDepth: 'normal',
        isFollowUp: true,
        topicChanged: true,
        confidence: 0.90,
        reasoning: 'Khách yêu cầu quay lại chủ đề / phòng trước đó trong lịch sử làm việc.',
      };
    }

    // 2.7. Live Room Availability Check ("Giờ anh qua luôn có phòng không?", "Chào em, phòng 601 còn không?")
    if (this.isAvailabilityInquiry(noDia)) {
      const hasSpecificRoom = resolvedRoom ?? (entities.room_name ? this.dataset.phong.find(p => p.ma_phong.includes(entities.room_name!) || p.ten_phong.includes(entities.room_name!)) : undefined);
      return {
        primaryGoal: 'CHECK_AVAILABILITY',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: hasSpecificRoom ? hasSpecificRoom.co_so_ma : effectiveFacility,
        referencedRoomId: hasSpecificRoom ? hasSpecificRoom.ma_phong : (activeRoom ? activeRoom.ma_phong : undefined),
        requestedFacts: ['availability'],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'brief',
        isFollowUp: hasSpecificRoom !== undefined,
        topicChanged: false,
        confidence: 0.96,
        reasoning: 'Kiểm tra phòng trống tức thì -> Nêu rõ chưa kết nối live PMS và hướng dẫn gọi hotline.',
      };
    }

    // 2.8. Direct Booking Attempt ("Chốt phòng 201 này nhé, đặt cho tôi...")
    if (this.isBookingIntent(noDia)) {
      return {
        primaryGoal: 'PROVIDE_BOOKING_GUIDE',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: activeRoom?.co_so_ma ?? effectiveFacility,
        referencedRoomId: activeRoom?.ma_phong,
        requestedFacts: ['booking_url', 'hotline'],
        requiredTools: ['NONE'],
        needsClarification: false,
        responseDepth: 'normal',
        isFollowUp: activeRoom !== undefined,
        topicChanged: false,
        confidence: 0.95,
        reasoning: 'Khách muốn chốt đặt phòng -> Cung cấp link website chính thức và hotline, không xác nhận fake booking.',
      };
    }

    // 2.9. Room Comparison ("So sánh phòng 101 với 601", "hai phòng này khác gì nhau")
    if (this.isCompareInquiry(noDia)) {
      return {
        primaryGoal: 'COMPARE_ROOMS',
        secondaryGoals: [],
        planner_mode: 'semantic_context',
        referencedPropertyId: effectiveFacility,
        requestedFacts: ['comparison'],
        requiredTools: ['ROOM_DETAIL_LOOKUP'],
        needsClarification: false,
        responseDepth: 'normal',
        isFollowUp: false,
        topicChanged: false,
        confidence: 0.92,
        reasoning: 'Khách yêu cầu so sánh phòng -> Trình bày bảng so sánh thuộc tính đã xác thực.',
      };
    }

    // 2.10. General / Deep Room Consultation & Search ("Tìm phòng lãng mạn", "Có phòng nào riêng tư không?")
    return {
      primaryGoal: 'CONSULT_AND_RECOMMEND',
      secondaryGoals: [],
      planner_mode: 'semantic_context',
      referencedPropertyId: effectiveFacility,
      requestedFacts: entities.must_have_amenities ?? [],
      requiredTools: ['SEARCH_ROOMS'],
      needsClarification: false,
      responseDepth: 'normal',
      isFollowUp: false,
      topicChanged: false,
      confidence: 0.85,
      reasoning: 'Khách cần tư vấn hoặc tìm phòng theo sở thích/tiện nghi -> Tìm kiếm và đề xuất phù hợp.',
    };
  }

  // =========================================================================
  // HELPER PREDICATES FOR FAST AND ACCURATE SEMANTIC UNDERSTANDING
  // =========================================================================

  private isPoliteClosing(raw: string, noDia: string): boolean {
    const isClosingIntent =
      noDia.includes('cam on') ||
      noDia.includes('thank') ||
      noDia.includes('tks') ||
      noDia.includes('nhan lai sau') ||
      noDia.includes('lien he lai sau') ||
      noDia.includes('ban lai') ||
      noDia.includes('tinh lai') ||
      noDia.includes('de xem da') ||
      noDia.includes('hen gap lai');

    // If there is an adversative marker, request for price, room, or category, NOT closing!
    if (
      noDia.includes('nhung') ||
      noDia.includes('tuy nhien') ||
      noDia.includes('bao gia') ||
      noDia.includes('cho anh') ||
      noDia.includes('cho em') ||
      noDia.includes('deluxe') ||
      noDia.includes('concept') ||
      noDia.includes('standard') ||
      this.isPriceInquiry(noDia)
    ) {
      return false;
    }

    const isAskingQuestion =
      noDia.includes('gia bao nhieu') ||
      noDia.includes('may gio') ||
      noDia.includes('con phong') ||
      noDia.includes('dat phong');

    return isClosingIntent && !isAskingQuestion;
  }

  private isInStayRequest(noDia: string): boolean {
    return (
      noDia.includes('them nuoc') ||
      noDia.includes('them khan') ||
      noDia.includes('don phong') ||
      noDia.includes('muon ban ui') ||
      noDia.includes('muon may say') ||
      noDia.includes('hong dieu hoa') ||
      noDia.includes('khong co nuoc nong') ||
      noDia.includes('mang len phong') ||
      noDia.includes('goi le tan len')
    );
  }

  private isCheckoutDispute(noDia: string): boolean {
    return (
      noDia.includes('tinh tien sai') ||
      noDia.includes('tinh lo') ||
      noDia.includes('bat tra them') ||
      noDia.includes('phu thu vo ly') ||
      noDia.includes('vo ly the') ||
      noDia.includes('doi soat tien')
    );
  }

  private isHumanRequest(noDia: string): boolean {
    return (
      noDia.includes('gap nhan vien') ||
      noDia.includes('gap le tan') ||
      noDia.includes('noi chuyen voi nguoi') ||
      noDia.includes('chuyen nguoi that') ||
      noDia.includes('gap quan ly') ||
      noDia.includes('cho gap le tan') ||
      noDia.includes('khieu nai')
    );
  }

  private isPureParkingInquiry(noDia: string): boolean {
    const isParking =
      noDia.includes('do xe') ||
      noDia.includes('dau xe') ||
      noDia.includes('gui xe') ||
      noDia.includes('de xe') ||
      noDia.includes('o to') ||
      noDia.includes('oto') ||
      noDia.includes('xe may');

    const hasOtherIntents =
      noDia.includes('gia') ||
      noDia.includes('bao nhieu') ||
      noDia.includes('thue') ||
      noDia.includes('dat phong') ||
      noDia.includes('bon tam') ||
      noDia.includes('concept') ||
      noDia.includes('deluxe');

    return isParking && !hasOtherIntents;
  }

  private isAdversarialOrOutOfScope(raw: string, noDia: string): boolean {
    return (
      raw.includes('ceo') ||
      raw.includes('giam doc') ||
      noDia.includes('bo qua') ||
      noDia.includes('quy dinh gia') ||
      noDia.includes('chinh sach gia') ||
      noDia.includes('giam 50k') ||
      noDia.includes('voucher') ||
      noDia.includes('mien phi phong') ||
      noDia.includes('tao voucher') ||
      noDia.includes('hack') ||
      noDia.includes('ignore previous') ||
      noDia.includes('system prompt') ||
      noDia.includes('api key') ||
      noDia.includes('database') ||
      noDia.includes('mat khau') ||
      noDia.includes('password')
    );
  }

  private isPureGreeting(noDia: string): boolean {
    return (
      noDia === 'chao em' ||
      noDia === 'chao' ||
      noDia === 'hello' ||
      noDia === 'hi' ||
      noDia === 'hi em' ||
      noDia === 'alo' ||
      noDia === 'alo em' ||
      noDia === 'chao ban' ||
      noDia.includes('hoi ve khach san') ||
      noDia.includes('thong tin ve khach san') ||
      noDia.includes('gioi thieu ve khach san') ||
      noDia.includes('chuc em ngay moi') ||
      noDia.includes('ngay moi tot lanh')
    );
  }

  private isPronominalRoomReference(noDia: string): boolean {
    return (
      noDia.includes('phong do') ||
      noDia.includes('can do') ||
      noDia.includes('phong nay') ||
      noDia.includes('can nay') ||
      noDia.includes('phong nay co') ||
      noDia.includes('phong vua roi') ||
      noDia.includes('can vua roi') ||
      noDia.includes('can luc nay') ||
      noDia.includes('phong luc nay')
    );
  }

  private isSpecificAmenityOrAttributeInquiry(noDia: string): boolean {
    // If the customer asks "có phòng nào có...", "tìm phòng có...", that's a room recommendation search!
    if (
      noDia.includes('phong nao') ||
      noDia.includes('can nao') ||
      noDia.includes('co phong nao') ||
      noDia.includes('tim phong') ||
      noDia.includes('can phong') ||
      noDia.includes('phong lang man co')
    ) {
      return false;
    }

    const hasAmenityWord =
      noDia.includes('bon tam') ||
      noDia.includes('bon doi') ||
      noDia.includes('bon lon') ||
      noDia.includes('bon ngam') ||
      noDia.includes('ghe tinh yeu') ||
      noDia.includes('tantra') ||
      noDia.includes('thang may') ||
      noDia.includes('may chieu') ||
      noDia.includes('bep');

    const cleanNoDia = noDia.replace(/\bkhong gian\b/g, '');

    const hasQuestionWord =
      cleanNoDia.includes('khong') ||
      cleanNoDia.includes('phai') ||
      cleanNoDia.includes('dung khong') ||
      cleanNoDia.includes('co phai') ||
      cleanNoDia.includes('ngoi vua') ||
      cleanNoDia.includes('2 nguoi') ||
      cleanNoDia.includes('hai nguoi') ||
      cleanNoDia.includes('rong khong') ||
      cleanNoDia.includes('the nao') ||
      cleanNoDia.includes('ra sao');

    return hasAmenityWord && hasQuestionWord;
  }

  private extractRequestedAmenityFact(noDia: string): string {
    if (noDia.includes('bon tam') || noDia.includes('bon doi') || noDia.includes('bon lon') || noDia.includes('bon ngam')) return 'bon_tam';
    if (noDia.includes('ghe tinh yeu') || noDia.includes('tantra')) return 'ghe_tinh_yeu';
    if (noDia.includes('thang may')) return 'thang_may';
    if (noDia.includes('may chieu')) return 'may_chieu';
    if (noDia.includes('bep')) return 'bep';
    return 'amenity';
  }

  private isRoomSpecialFeaturesInquiry(noDia: string): boolean {
    return (
      noDia.includes('co gi dac biet') ||
      noDia.includes('co gi hot') ||
      noDia.includes('co gi nao') ||
      noDia.includes('dac diem') ||
      noDia.includes('thong tin phong')
    );
  }

  private isImageRequest(raw: string, noDia: string): boolean {
    // Negation guard: "Anh không cần ảnh, anh cần giá", "đừng gửi ảnh", etc.
    const isNegated =
      noDia.includes('khong can anh') ||
      noDia.includes('khong xem anh') ||
      noDia.includes('khong lay anh') ||
      noDia.includes('dung gui anh') ||
      noDia.includes('chua can anh') ||
      noDia.includes('khong can hinh');
    if (isNegated) {
      return false;
    }

    const hasPhotoWithDiacritics = raw.includes('ảnh') || raw.includes('hình') || raw.includes('pic');
    const hasPhotoCompound =
      noDia.includes('hinh anh') ||
      noDia.includes('xem anh') ||
      noDia.includes('gui anh') ||
      noDia.includes('co anh khong') ||
      noDia.includes('cho anh xem anh') ||
      noDia.includes('cho xem anh') ||
      noDia.includes('buc anh') ||
      noDia.includes('tam anh') ||
      noDia.includes('photo');

    return hasPhotoWithDiacritics || hasPhotoCompound;
  }

  private isPriceInquiry(noDia: string): boolean {
    // Negation guard: "Anh hỏi bồn lớn thôi, không hỏi giá."
    if (
      noDia.includes('khong hoi gia') ||
      noDia.includes('khong can gia') ||
      noDia.includes('khong hoi tien') ||
      noDia.includes('khong can bao gia')
    ) {
      return false;
    }

    if (
      noDia.includes('gia duoi') ||
      noDia.includes('gia tam') ||
      noDia.includes('ngan sach') ||
      noDia.includes('duoi 500k')
    ) {
      return false;
    }
    if (
      (noDia.includes('tim') || noDia.includes('can phong') || noDia.includes('co phong nao')) &&
      !noDia.includes('bao nhieu') &&
      !noDia.includes('bao tien') &&
      !noDia.includes('gia sao')
    ) {
      return false;
    }

    return (
      noDia.includes('gia bao nhieu') ||
      noDia.includes('bao nhieu') ||
      noDia.includes('bao tien') ||
      noDia.includes('bao gia') ||
      noDia.includes('chi phi') ||
      noDia.includes('gia sao') ||
      noDia.includes('gia ro') ||
      noDia.includes('tinh gia') ||
      noDia.includes('tinh tien') ||
      noDia.includes('tinh cho anh') ||
      noDia.includes('bang gia') ||
      noDia.includes('gia phong') ||
      noDia.includes('gia the nao') ||
      noDia.includes('gia ca') ||
      noDia.includes('bieu gia') ||
      (noDia.includes('can gia') && !noDia.includes('khong can gia')) ||
      (noDia.includes('gia') && (noDia.includes('deluxe') || noDia.includes('standard') || noDia.includes('concept')))
    );
  }

  private extractCategoryFromUtterance(noDia: string): RawRoomCategory | undefined {
    if (noDia.includes('deluxe')) return 'Deluxe';
    if (noDia.includes('concept') || noDia.includes('suite')) return 'Concept';
    if (noDia.includes('standard') || noDia.includes('superior')) return 'Standard';
    return undefined;
  }

  private isTopicOrCategoryChange(noDia: string): boolean {
    return (
      noDia.includes('doi sang') ||
      noDia.includes('chuyen sang') ||
      noDia.includes('khong thich kieu nay') ||
      noDia.includes('co gi khac khong') ||
      noDia.includes('loai khac') ||
      noDia.includes('phong khac') ||
      noDia.includes('thoi khong lay') ||
      noDia.includes('thoi khong thue') ||
      noDia.includes('xem phong khac') ||
      noDia.includes('khong thue')
    );
  }

  private isResumePreviousTopic(noDia: string): boolean {
    return (
      noDia.includes('loai truoc thi sao') ||
      noDia.includes('loai luc truoc') ||
      noDia.includes('phong truoc') ||
      noDia.includes('phong luc truoc') ||
      noDia.includes('quay lai phong') ||
      noDia.includes('quay lai can') ||
      noDia.includes('phong dau tien') ||
      noDia.includes('can dau tien')
    );
  }

  private isAvailabilityInquiry(noDia: string): boolean {
    if (noDia.includes('thi sao') || noDia.includes('luc truoc') || noDia.includes('quay lai')) {
      return false;
    }

    return (
      noDia.includes('con phong khong') ||
      noDia.includes('con phong ko') ||
      noDia.includes('con phong k') ||
      noDia.includes('con khong') ||
      noDia.includes('con ko') ||
      noDia.includes('con k') ||
      noDia.includes('phong trong') ||
      noDia.includes('het phong') ||
      noDia.includes('qua luon') ||
      noDia.includes('toi luon') ||
      noDia.includes('den luon') ||
      noDia.includes('co phong ngay') ||
      (noDia.includes('con phong') &&
        (noDia.includes('ngay bay gio') ||
          noDia.includes('gio nay') ||
          noDia.includes('toi nay') ||
          noDia.includes('hom nay')))
    );
  }

  private isBookingIntent(noDia: string): boolean {
    return (
      noDia.includes('chot phong') ||
      noDia.includes('dat phong nay') ||
      noDia.includes('dat luon') ||
      noDia.includes('giu phong cho anh') ||
      noDia.includes('giu phong giup')
    );
  }

  private isCompareInquiry(noDia: string): boolean {
    return (
      noDia.includes('so sanh') ||
      noDia.includes('khac gi nhau') ||
      noDia.includes('khac nhau') ||
      noDia.includes('phong nao hon') ||
      noDia.includes('nen chon phong') ||
      (noDia.includes('hay') && noDia.includes('hon'))
    );
  }
}
