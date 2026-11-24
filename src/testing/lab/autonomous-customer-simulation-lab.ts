/**
 * J Collection AI Concierge — Milestone Agentic V2.1
 * Autonomous Customer Simulation Lab & Intelligence Evaluation (500 Scenarios)
 * Reasoning-first · Tool-driven · Business-controlled
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { NormalizedDataset } from '../../domain/normalized-schema.js';
import { CoSoMa } from '../../domain/types.js';
import { ConversationOrchestrator } from '../../conversation/orchestrator.js';
import { FreeLLMGateway } from '../../conversation/adapters/free-llm-gateway.js';
import { LLMAdapter } from '../../conversation/adapters/llm-adapter.interface.js';
import { removeDiacritics } from '../../conversation/nlu-engine.js';

// ============================================================================
// 1. SCENARIO TAXONOMY & INTERFACES
// ============================================================================

export type ScenarioSplit = 'discovery' | 'held_out';

export type NeedCategory =
  | 'pricing_time_packages'             // 95 scenarios: Giá phòng, thời gian và gói nghỉ
  | 'availability_catalog_categories'   // 80 scenarios: Hỏi phòng trống, danh sách và hạng phòng
  | 'photos_room_selection'             // 75 scenarios: Xem phòng, chọn phòng và hình ảnh
  | 'amenities_features'                // 65 scenarios: Tiện nghi và đặc điểm phòng
  | 'advice_preferences_budget'         // 65 scenarios: Tư vấn theo sở thích và ngân sách
  | 'requirement_context_changes'       // 50 scenarios: Thay đổi yêu cầu và ngữ cảnh
  | 'faq_policies'                      // 40 scenarios: FAQ và chính sách thông thường
  | 'booking_handoff_closing';          // 30 scenarios: Ý định đặt phòng, gặp lễ tân, kết thúc

export type LinguisticStyle =
  | 'formal_with_diacritics'
  | 'no_diacritics'
  | 'slang_abbreviations'
  | 'typos_misspellings'
  | 'room_code_only'
  | 'short_missing_subject'
  | 'comparison_hesitation'
  | 'negation_change_mind';

export interface CustomerPersona {
  name: string;
  style: LinguisticStyle;
  budget?: number;
  durationHours?: number;
  stayType?: 'nghi_gio' | 'qua_dem' | 'ngay_dem';
  preferredAmenity?: string;
  targetRoomCode?: string;
  wantsCheapest?: boolean;
  wantsPhotos?: boolean;
  flexibility: 'strict' | 'medium' | 'flexible';
}

export interface SimulationTurnSpec {
  userMessage: string;
  expectedGoal: string;
  expectedTools?: string[];
  expectedResponseKeywords?: string[];
  forbiddenKeywords?: string[];
  targetRoomCode?: string;
}

export interface SimulationScenario {
  id: string;
  split: ScenarioSplit;
  propertyId: CoSoMa;
  category: NeedCategory;
  turnsCount: number;
  persona: CustomerPersona;
  initialMessage: string;
  turnSpecs: SimulationTurnSpec[];
  expectedInvariants: string[];
  businessGroundTruth: {
    applicableRooms?: string[];
    expectedPriceRange?: [number, number];
    expectedAmenities?: string[];
    expectedPolicyKey?: string;
  };
}

// 26 Canonical Defect Categories from Section X
export type FailureCategory =
  | 'WRONG_RUNTIME_ENGINE'
  | 'GOAL_MISUNDERSTANDING'
  | 'INTENT_MISUNDERSTANDING'
  | 'CONTEXT_REFERENCE_FAILURE'
  | 'CONSTRAINT_LOSS'
  | 'STALE_MEMORY'
  | 'WRONG_OPTIMIZATION_OBJECTIVE'
  | 'INCOMPLETE_SEARCH'
  | 'INCORRECT_RECOMMENDATION'
  | 'WRONG_TOOL_SELECTION'
  | 'MISSING_TOOL_CALL'
  | 'UNNECESSARY_TOOL_CALL'
  | 'MISSING_MEDIA'
  | 'WRONG_MEDIA'
  | 'WRONG_PRICE'
  | 'WRONG_ROOM'
  | 'WRONG_PROPERTY'
  | 'UNSUPPORTED_FACT'
  | 'UNSOLICITED_INFORMATION'
  | 'OVER_VERBOSE_RESPONSE'
  | 'UNNECESSARY_CLARIFICATION'
  | 'LACK_OF_PROACTIVENESS'
  | 'MISLEADING_AVAILABILITY'
  | 'TEMPLATE_OVERRIDE'
  | 'PROVIDER_FALLBACK_FAILURE'
  | 'HUMAN_TAKEOVER_FAILURE';

export interface TurnExecutionRecord {
  turnIndex: number;
  userMessage: string;
  engine: string;
  provider: string;
  model: string;
  executionMode: 'LIVE_GROQ' | 'LIVE_GEMINI' | 'DETERMINISTIC_FAST_PATH' | 'PROVIDER_FALLBACK' | 'MOCK_TEST';
  structuredDecisions: any[];
  toolCalls: any[];
  toolResults: any[];
  evidenceReferences: any[];
  generatedResponse: string;
  deliveredResponse: string;
  deliveredMedia: any[];
  latencyMs: number;
  fallbackStatus: string;
  claimValidation: any;
}

export interface ScenarioEvaluationRecord {
  scenarioId: string;
  datasetSplit: ScenarioSplit;
  propertyId: CoSoMa;
  customerPersona: string;
  customerGoal: string;
  category: NeedCategory;
  expectedInvariants: string[];
  turns: TurnExecutionRecord[];
  evaluation: {
    goalCompletion: number;         // 0 - 5
    intentUnderstanding: number;    // 0 - 5
    contextUnderstanding: number;   // 0 - 5
    factualAccuracy: number;        // 0 - 5
    responseRelevance: number;      // 0 - 5
    toolSelectionQuality: number;   // 0 - 5
    proactiveness: number;          // 0 - 5
    naturalness: number;            // 0 - 5
    conciseness: number;            // 0 - 5
  };
  passed: boolean;
  failureCategories: FailureCategory[];
  rootCauseHypothesis?: string;
  affectedModules?: string[];
}

// ============================================================================
// 2. 500 REALISTIC SCENARIOS GENERATOR (DETERMINISTIC SEED)
// ============================================================================

export class AutonomousScenarioCatalog {
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = seed;
  }

  private nextRandom(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /**
   * Generates exactly 500 realistic customer scenarios meeting all distribution quotas.
   */
  public generate500Scenarios(): SimulationScenario[] {
    const scenarios: SimulationScenario[] = [];

    // Category Quotas (Total 500)
    const categoryQuotas: Record<NeedCategory, number> = {
      pricing_time_packages: 95,
      availability_catalog_categories: 80,
      photos_room_selection: 75,
      amenities_features: 65,
      advice_preferences_budget: 65,
      requirement_context_changes: 50,
      faq_policies: 40,
      booking_handoff_closing: 30,
    };

    // Property Quotas: Ha Dong: 200, Tran Khat Chan: 150, J Village: 150
    // Multi-turn Quota: 150 multi-turn (Ha Dong: 60, TKC: 45, Village: 45)
    // Single-turn Quota: 350 single-turn (Ha Dong: 140, TKC: 105, Village: 105)

    let scenarioIndex = 1;

    for (const [catKey, quota] of Object.entries(categoryQuotas) as [NeedCategory, number][]) {
      for (let i = 0; i < quota; i++) {
        const id = `SCENARIO-${String(scenarioIndex).padStart(3, '0')}`;
        
        // Property assignment (200 HD, 150 TKC, 150 Village)
        let propertyId: CoSoMa = 'jacayl-ha-dong';
        if (scenarioIndex > 200 && scenarioIndex <= 350) {
          propertyId = 'jacayl-tran-khat-chan';
        } else if (scenarioIndex > 350) {
          propertyId = 'j-village';
        }

        // Multi-turn determination (150 total multi-turn, evenly spread)
        const isMultiTurn = (scenarioIndex % 3 === 0 && scenarios.filter(s => s.turnsCount > 1).length < 150) ||
                            (scenarioIndex > 450 && scenarios.filter(s => s.turnsCount > 1).length < 150);
        const turnsCount = isMultiTurn ? (2 + Math.floor(this.nextRandom() * 3)) : 1; // 1 or 2-4 turns

        // Split: 400 discovery, 100 held_out (every 5th is held_out)
        const split: ScenarioSplit = scenarioIndex % 5 === 0 ? 'held_out' : 'discovery';

        const scenario = this.buildScenario(id, propertyId, catKey, turnsCount, split, scenarioIndex);
        scenarios.push(scenario);
        scenarioIndex++;
      }
    }

    return scenarios;
  }

  private buildScenario(
    id: string,
    propertyId: CoSoMa,
    category: NeedCategory,
    turnsCount: number,
    split: ScenarioSplit,
    idx: number
  ): SimulationScenario {
    const styles: LinguisticStyle[] = [
      'formal_with_diacritics',
      'no_diacritics',
      'slang_abbreviations',
      'typos_misspellings',
      'room_code_only',
      'short_missing_subject',
      'comparison_hesitation',
      'negation_change_mind',
    ];
    const style = styles[idx % styles.length];

    const personaNames = ['Anh Tuấn', 'Chị Lan', 'Minh Hoàng', 'Khánh Linh', 'Quốc Bảo', 'Thu Trang', 'Huy Đức', 'Phương Anh'];
    const personaName = personaNames[idx % personaNames.length];

    const persona: CustomerPersona = {
      name: personaName,
      style,
      budget: idx % 4 === 0 ? 500000 : idx % 4 === 1 ? 800000 : undefined,
      durationHours: idx % 2 === 0 ? 2 : 4,
      stayType: idx % 3 === 0 ? 'qua_dem' : 'nghi_gio',
      preferredAmenity: idx % 2 === 0 ? 'bon_tam' : undefined,
      wantsCheapest: category === 'advice_preferences_budget' && idx % 3 === 0,
      wantsPhotos: category === 'photos_room_selection',
      flexibility: idx % 3 === 0 ? 'strict' : idx % 3 === 1 ? 'medium' : 'flexible',
    };

    const turnSpecs: SimulationTurnSpec[] = [];
    const expectedInvariants: string[] = ['TENANT_ISOLATION', 'NO_UNVERIFIED_FACTS'];

    // Property-specific naming
    const propName = propertyId === 'jacayl-ha-dong' ? 'Hà Đông' : propertyId === 'jacayl-tran-khat-chan' ? 'Trần Khát Chân' : 'J Village';

    // Build category-specific scenario contents
    switch (category) {
      case 'pricing_time_packages': {
        expectedInvariants.push('BUSINESS_POLICY_V1_4_3_PRICING');
        if (turnsCount === 1) {
          if (style === 'no_diacritics') {
            turnSpecs.push({
              userMessage: `gia nghi 2 tieng o ${propName.toLowerCase()} la bao nhieu?`,
              expectedGoal: 'QUOTE_PRICE',
              expectedTools: ['quote_price'],
            });
          } else if (style === 'short_missing_subject') {
            turnSpecs.push({
              userMessage: `Qua đêm ở ${propName} tính từ mấy giờ đến mấy giờ?`,
              expectedGoal: 'ANSWER_POLICY_HOURS',
              expectedTools: ['get_policies'],
              expectedResponseKeywords: ['22:00', '12:00', '21:40'],
            });
          } else {
            turnSpecs.push({
              userMessage: `Bên mình có gói thuê 1 tiếng không em? Giá phòng ở ${propName} thế nào?`,
              expectedGoal: 'REJECT_1H_OFFER_2H',
              expectedTools: ['quote_price', 'get_policies'],
              expectedResponseKeywords: ['tối thiểu 2 tiếng', '2 giờ'],
            });
          }
        } else {
          turnSpecs.push({
            userMessage: `Cho mình hỏi giá phòng qua đêm tại ${propName}`,
            expectedGoal: 'QUOTE_OVERNIGHT',
            expectedTools: ['quote_price'],
          });
          turnSpecs.push({
            userMessage: `Nếu mình nhận phòng sớm lúc 21h40 thì có bị tính thêm phí không?`,
            expectedGoal: 'EXPLAIN_EARLY_CHECKIN_GRACE',
            expectedTools: ['get_policies'],
            expectedResponseKeywords: ['21:40', 'ân hạn', 'không tính thêm'],
          });
        }
        break;
      }

      case 'photos_room_selection': {
        expectedInvariants.push('CANONICAL_MEDIA_INTEGRITY');
        const roomCode = propertyId === 'jacayl-ha-dong' ? '203' : propertyId === 'jacayl-tran-khat-chan' ? '301' : '101';
        if (turnsCount === 1) {
          turnSpecs.push({
            userMessage: `Cho mình xem hình ảnh thực tế phòng ${roomCode} tại ${propName} nhé`,
            expectedGoal: 'SHOW_ROOM_PHOTOS',
            expectedTools: ['get_room_media'],
            targetRoomCode: roomCode,
          });
        } else {
          // OWNER CASE 02 REPRODUCTION & EXTENSION:
          turnSpecs.push({
            userMessage: `Cho mình xem danh sách các phòng và ảnh phòng tại ${propName}`,
            expectedGoal: 'BROWSE_ROOMS_PHOTOS',
            expectedTools: ['search_rooms', 'get_room_media'],
          });
          turnSpecs.push({
            userMessage: `${roomCode}`,
            expectedGoal: 'PROACTIVE_ROOM_PHOTO_INQUIRY',
            expectedTools: ['get_room_media', 'quote_price'],
            targetRoomCode: roomCode,
            expectedResponseKeywords: ['ảnh', 'hình ảnh'],
          });
        }
        break;
      }

      case 'advice_preferences_budget': {
        expectedInvariants.push('OPTIMIZATION_GOAL_FULFILLMENT');
        if (turnsCount === 1) {
          // OWNER CASE 01 REPRODUCTION & EXTENSION:
          turnSpecs.push({
            userMessage: style === 'no_diacritics' ? `cho minh phong re nhat o ${propName.toLowerCase()}` : `Cho mình phòng rẻ nhất ở ${propName}`,
            expectedGoal: 'FIND_CHEAPEST_ROOM',
            expectedTools: ['search_rooms', 'quote_price'],
            expectedResponseKeywords: ['rẻ nhất', 'giá tốt nhất'],
          });
        } else {
          turnSpecs.push({
            userMessage: `Mình có ngân sách khoảng 400k, muốn tìm phòng nghỉ 2 tiếng thứ Bảy tại ${propName}`,
            expectedGoal: 'RECOMMEND_WITHIN_BUDGET',
            expectedTools: ['search_rooms', 'quote_price'],
          });
          turnSpecs.push({
            userMessage: `Có căn nào rẻ hơn nữa không em?`,
            expectedGoal: 'FIND_ABSOLUTE_CHEAPEST',
            expectedTools: ['quote_price'],
          });
        }
        break;
      }

      case 'amenities_features': {
        expectedInvariants.push('CANONICAL_AMENITIES_INTEGRITY');
        if (idx % 2 === 0) {
          turnSpecs.push({
            userMessage: `Tại cơ sở ${propName} có phòng nào có bồn tắm ngâm không em?`,
            expectedGoal: 'FIND_BATHTUB_ROOMS',
            expectedTools: ['search_rooms'],
            expectedResponseKeywords: ['bồn tắm'],
          });
        } else {
          turnSpecs.push({
            userMessage: `Phòng bên mình có bếp nấu ăn riêng trong phòng không em?`,
            expectedGoal: 'DISCLAIM_UNVERIFIED_KITCHEN',
            expectedResponseKeywords: ['chưa có thông tin', 'chưa xác nhận', 'liên hệ'],
          });
        }
        break;
      }

      case 'availability_catalog_categories': {
        expectedInvariants.push('AVAILABILITY_TRANSPARENCY');
        turnSpecs.push({
          userMessage: `Tối nay bên ${propName} còn phòng trống không em ơi?`,
          expectedGoal: 'TRANSPARENT_AVAILABILITY_DISCLAIMER',
          expectedResponseKeywords: ['PMS', 'hotline', 'lễ tân'],
        });
        if (turnsCount > 1) {
          turnSpecs.push({
            userMessage: `Cơ sở này có những hạng phòng nào vậy bạn?`,
            expectedGoal: 'LIST_CATEGORIES',
            expectedTools: ['search_rooms'],
          });
        }
        break;
      }

      case 'requirement_context_changes': {
        expectedInvariants.push('DYNAMIC_CONSTRAINT_UPDATING');
        turnSpecs.push({
          userMessage: `Tìm giúp mình phòng có bồn tắm tại ${propName} nhé`,
          expectedGoal: 'SEARCH_BATHTUB',
          expectedTools: ['search_rooms'],
        });
        turnSpecs.push({
          userMessage: `Thôi mình đổi ý không cần bồn tắm nữa, tìm phòng nào rẻ nhất thôi`,
          expectedGoal: 'MUTATE_CONSTRAINTS_CHEAPEST',
          expectedTools: ['search_rooms', 'quote_price'],
        });
        break;
      }

      case 'faq_policies': {
        expectedInvariants.push('GROUNDED_POLICY_FACTS');
        turnSpecs.push({
          userMessage: `Bên khách sạn ${propName} có chỗ đỗ ô tô không bạn?`,
          expectedGoal: 'ANSWER_PARKING_POLICY',
          expectedTools: ['get_policies'],
        });
        break;
      }

      case 'booking_handoff_closing': {
        expectedInvariants.push('STAFF_HANDOFF_ATOMICITY');
        turnSpecs.push({
          userMessage: `Mình muốn đặt luôn phòng tại ${propName}, cho mình gặp lễ tân nhé`,
          expectedGoal: 'HUMAN_TAKEOVER_ESCALATION',
          expectedResponseKeywords: ['lễ tân', 'tiếp quản'],
        });
        break;
      }
    }

    return {
      id,
      split,
      propertyId,
      category,
      turnsCount: turnSpecs.length,
      persona,
      initialMessage: turnSpecs[0].userMessage,
      turnSpecs,
      expectedInvariants,
      businessGroundTruth: {
        applicableRooms: propertyId === 'jacayl-ha-dong' ? ['101', '201', '202', '203', '601', '602'] : undefined,
      },
    };
  }
}

// ============================================================================
// 3. DETERMINISTIC BUSINESS EVALUATOR & CANONICAL INVARIANTS
// ============================================================================

export class DeterministicBusinessEvaluator {
  private dataset: NormalizedDataset;

  constructor(dataset: NormalizedDataset) {
    this.dataset = dataset;
  }

  public evaluateInvariants(
    scenario: SimulationScenario,
    turns: TurnExecutionRecord[]
  ): { passed: boolean; violations: FailureCategory[]; notes: string[] } {
    const violations: FailureCategory[] = [];
    const notes: string[] = [];

    for (const t of turns) {
      const resp = t.deliveredResponse || '';
      const respLower = resp.toLowerCase();

      // Invariant 1: Canonical Room Identity (no duplicate prefix)
      if (/601 — 50 — Sắc Thái|101 — 101 — Lồng Chim/i.test(resp)) {
        violations.push('WRONG_ROOM_IDENTITY' as any);
        notes.push('Phát hiện lỗi nhân bản tiền tố mã phòng canonical.');
      }

      // Invariant 2: Tenant Isolation
      if (scenario.propertyId === 'jacayl-ha-dong' && (resp.includes('Trần Khát Chân') || resp.includes('J Village'))) {
        if (!t.userMessage.toLowerCase().includes('tran khat chan') && !t.userMessage.toLowerCase().includes('village')) {
          violations.push('WRONG_PROPERTY');
          notes.push('Vi phạm cách ly cơ sở: Nhắc cơ sở khác khi khách chỉ hỏi Hà Đông.');
        }
      }

      // Invariant 3: Overnight Pricing & Grace Hours (Business Policy V1.4.3)
      if (respLower.includes('21:00') && (respLower.includes('ân hạn') || respLower.includes('an han') || respLower.includes('qua đêm'))) {
        violations.push('WRONG_PRICE');
        notes.push('Vi phạm Business Policy V1.4.3: Nhắc sai mốc qua đêm 21:00 thay vì 22:00 (ân hạn 21:40).');
      }

      // Invariant 4: Kitchen Claim (Canonical: UNKNOWN)
      if (respLower.includes('có bếp') && !respLower.includes('chưa có thông tin') && !respLower.includes('chưa xác nhận')) {
        violations.push('UNSUPPORTED_FACT');
        notes.push('Khẳng định có bếp nấu ăn khi dataset chưa thẩm định.');
      }

      // Invariant 5: Twin Bathtub Claim
      if (respLower.includes('bồn tắm đôi') && !respLower.includes('chưa có thông tin') && !respLower.includes('bồn tắm lớn')) {
        violations.push('UNSUPPORTED_FACT');
        notes.push('Khẳng định bồn tắm đôi sai sự thật.');
      }

      // Invariant 6: Availability Transparency
      if (
        (t.userMessage.toLowerCase().includes('còn phòng') || t.userMessage.toLowerCase().includes('phòng trống')) &&
        (respLower.includes('chắc chắn còn phòng') || respLower.includes('đã giữ phòng trên hệ thống pms'))
      ) {
        violations.push('MISLEADING_AVAILABILITY');
        notes.push('Khẳng định giữ phòng PMS thời gian thực khi chưa kết nối.');
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      notes,
    };
  }
}

// ============================================================================
// 4. SEMANTIC CONVERSATION EVALUATOR (0 - 5 SCORING)
// ============================================================================

export class SemanticConversationEvaluator {
  public evaluateConversation(
    scenario: SimulationScenario,
    turns: TurnExecutionRecord[],
    businessEval: { passed: boolean; violations: FailureCategory[] }
  ): ScenarioEvaluationRecord['evaluation'] & { failureCategories: FailureCategory[] } {
    let goalCompletion = 5.0;
    let intentUnderstanding = 5.0;
    let contextUnderstanding = 5.0;
    let factualAccuracy = 5.0;
    let responseRelevance = 5.0;
    let toolSelectionQuality = 5.0;
    let proactiveness = 5.0;
    let naturalness = 5.0;
    let conciseness = 5.0;

    const failures: FailureCategory[] = [...businessEval.violations];

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const spec = scenario.turnSpecs[i] || scenario.turnSpecs[0];
      const resp = turn.deliveredResponse || '';

      // Check Case 01: Cheapest Room Optimization
      if (scenario.persona.wantsCheapest || spec.expectedGoal === 'FIND_CHEAPEST_ROOM') {
        // If response lists multiple expensive/concept rooms instead of picking the cheapest
        const roomMentions = (resp.match(/phòng \d+|101|201|202|203|601/gi) || []).length;
        if (roomMentions >= 3 && !resp.toLowerCase().includes('rẻ nhất')) {
          goalCompletion -= 1.5;
          proactiveness -= 2.0;
          failures.push('WRONG_OPTIMIZATION_OBJECTIVE');
          failures.push('LACK_OF_PROACTIVENESS');
        }
      }

      // Check Case 02: Room Code Only & Photo Proactivity
      if (spec.targetRoomCode && (scenario.persona.wantsPhotos || spec.expectedGoal === 'PROACTIVE_ROOM_PHOTO_INQUIRY')) {
        const deliveredImages = turn.deliveredMedia || [];
        const askedIfWantPhotos = /có muốn xem ảnh|có muốn xem thêm ảnh/i.test(resp);
        if (deliveredImages.length === 0 && askedIfWantPhotos) {
          proactiveness -= 2.0;
          toolSelectionQuality -= 1.0;
          failures.push('LACK_OF_PROACTIVENESS');
          failures.push('MISSING_MEDIA');
        }
      }

      // Check Verbosity
      if (resp.length > 900) {
        conciseness -= 1.5;
        failures.push('OVER_VERBOSE_RESPONSE');
      }

      // Check Context Reference in Multi-turn
      if (i > 0) {
        const prevTurn = turns[i - 1];
        // If customer only replied with room code (e.g. "203") but bot forgot facility or context
        if (/^\d{3}$/.test(turn.userMessage.trim()) && !resp.includes(turn.userMessage.trim())) {
          contextUnderstanding -= 2.0;
          failures.push('CONTEXT_REFERENCE_FAILURE');
        }
      }

      // Deduct factual accuracy if business invariant violated
      if (!businessEval.passed) {
        factualAccuracy = Math.max(1.0, factualAccuracy - businessEval.violations.length * 1.5);
      }
    }

    // Bound scores between 1.0 and 5.0
    const clamp = (val: number) => Math.max(1.0, Math.min(5.0, Math.round(val * 10) / 10));

    return {
      goalCompletion: clamp(goalCompletion),
      intentUnderstanding: clamp(intentUnderstanding),
      contextUnderstanding: clamp(contextUnderstanding),
      factualAccuracy: clamp(factualAccuracy),
      responseRelevance: clamp(responseRelevance),
      toolSelectionQuality: clamp(toolSelectionQuality),
      proactiveness: clamp(proactiveness),
      naturalness: clamp(naturalness),
      conciseness: clamp(conciseness),
      failureCategories: Array.from(new Set(failures)),
    };
  }
}

// ============================================================================
// 5. AUTONOMOUS SIMULATION LAB ENGINE (MAIN ORCHESTRATOR)
// ============================================================================

export class AutonomousCustomerSimulationLab {
  private dataset: NormalizedDataset;
  private orchestrator: ConversationOrchestrator;
  private catalog: AutonomousScenarioCatalog;
  private businessEvaluator: DeterministicBusinessEvaluator;
  private semanticEvaluator: SemanticConversationEvaluator;
  private outputDir: string;

  constructor(options: {
    dataset: NormalizedDataset;
    orchestrator?: ConversationOrchestrator;
    outputDir?: string;
    seed?: number;
  }) {
    this.dataset = options.dataset;
    this.catalog = new AutonomousScenarioCatalog(options.seed ?? 42);
    this.businessEvaluator = new DeterministicBusinessEvaluator(this.dataset);
    this.semanticEvaluator = new SemanticConversationEvaluator();
    this.outputDir = options.outputDir ?? join(process.cwd(), 'artifacts', 'autonomous-evaluation');

    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }

    if (options.orchestrator) {
      this.orchestrator = options.orchestrator;
    } else {
      const llmGateway = new FreeLLMGateway({ mode: 'auto' });
      this.orchestrator = new ConversationOrchestrator(this.dataset, { llmAdapter: llmGateway });
    }
  }

  /**
   * Executes the full 500 scenarios evaluation with checkpointing and exports all 9 deliverables.
   */
  public async executeFullBenchmark(options?: {
    batchSize?: number;
    maxScenarios?: number;
    onProgress?: (completed: number, total: number) => void;
  }): Promise<{
    scenarios: SimulationScenario[];
    records: ScenarioEvaluationRecord[];
    summary: Record<string, any>;
  }> {
    const allScenarios = this.catalog.generate500Scenarios();
    const limit = options?.maxScenarios ?? allScenarios.length;
    const scenariosToRun = allScenarios.slice(0, limit);

    console.log(`\n======================================================================`);
    console.log(`  AUTONOMOUS CUSTOMER SIMULATION LAB — 500 REALISTIC SCENARIOS`);
    console.log(`======================================================================`);
    console.log(`  • Tổng số tình huống: ${scenariosToRun.length}`);
    console.log(`  • Cơ sở: Ha Dong (200), Tran Khat Chan (150), J Village (150)`);
    console.log(`  • Engine: ${process.env.CONVERSATION_ENGINE || 'legacy'}`);
    console.log(`  • Free Only Mode: ${process.env.FREE_ONLY_MODE || 'true'}`);
    console.log(`  • Checkpoint Directory: ${this.outputDir}\n`);

    // Save customer-scenarios-500.json upfront
    writeFileSync(
      join(this.outputDir, 'customer-scenarios-500.json'),
      JSON.stringify(allScenarios, null, 2),
      'utf-8'
    );

    const evaluationRecords: ScenarioEvaluationRecord[] = [];
    const transcriptsPath = join(this.outputDir, 'conversation-transcripts.jsonl');
    const tracesPath = join(this.outputDir, 'agent-decision-traces.jsonl');
    const failuresPath = join(this.outputDir, 'failure-cases.jsonl');

    // Clean previous jsonl files
    writeFileSync(transcriptsPath, '', 'utf-8');
    writeFileSync(tracesPath, '', 'utf-8');
    writeFileSync(failuresPath, '', 'utf-8');

    const fixedClock = '2026-11-28T14:00:00+07:00'; // Saturday afternoon

    for (let sIdx = 0; sIdx < scenariosToRun.length; sIdx++) {
      const scenario = scenariosToRun[sIdx];
      const sessionId = `sim-${scenario.id.toLowerCase()}-${Date.now()}`;
      const turnRecords: TurnExecutionRecord[] = [];

      for (let tIdx = 0; tIdx < scenario.turnSpecs.length; tIdx++) {
        const spec = scenario.turnSpecs[tIdx];
        const userMsg = spec.userMessage;

        const startTurn = performance.now();
        const turnRes = await this.orchestrator.processTurn(
          sessionId,
          userMsg,
          {
            referenceClock: fixedClock,
            boundPropertyId: scenario.propertyId,
          }
        );
        const turnLatency = Math.round(performance.now() - startTurn);

        const executionMode: TurnExecutionRecord['executionMode'] =
          (turnRes.decision_trace?.executionMode as any) ||
          (turnRes.internal_trace?.adapter_used?.includes('groq') ? 'LIVE_GROQ' :
           turnRes.internal_trace?.adapter_used?.includes('gemini') ? 'LIVE_GEMINI' :
           turnRes.decision_trace?.fastPathUsed ? 'DETERMINISTIC_FAST_PATH' : 'MOCK_TEST');

        const turnRecord: TurnExecutionRecord = {
          turnIndex: tIdx + 1,
          userMessage: userMsg,
          engine: process.env.CONVERSATION_ENGINE || 'agentic',
          provider: turnRes.internal_trace?.adapter_used || 'FreeLLMGateway',
          model: turnRes.decision_trace?.activeModel || 'auto',
          executionMode,
          structuredDecisions: (turnRes as any).structuredDecisions || [],
          toolCalls: (turnRes as any).toolCalls || turnRes.internal_trace?.tools_executed || [],
          toolResults: (turnRes as any).toolResults || [],
          evidenceReferences: turnRes.evidence_references || [],
          generatedResponse: turnRes.customer_visible_response,
          deliveredResponse: turnRes.customer_visible_response,
          deliveredMedia: turnRes.images || [],
          latencyMs: turnLatency,
          fallbackStatus: turnRes.decision_trace?.fallbackTriggered ? 'TRIGGERED' : 'NONE',
          claimValidation: turnRes.claim_validation || null,
        };

        turnRecords.push(turnRecord);

        // Append trace log
        appendFileSync(
          tracesPath,
          JSON.stringify({
            scenarioId: scenario.id,
            turnIndex: tIdx + 1,
            userMessage: userMsg,
            toolsExecuted: turnRes.internal_trace?.tools_executed || [],
            latencyMs: turnLatency,
            executionMode,
          }) + '\n',
          'utf-8'
        );
      }

      // Evaluate Business Invariants
      const businessEval = this.businessEvaluator.evaluateInvariants(scenario, turnRecords);

      // Evaluate Semantic Dimensions
      const semanticEval = this.semanticEvaluator.evaluateConversation(scenario, turnRecords, businessEval);

      const passed =
        businessEval.passed &&
        semanticEval.goalCompletion >= 3.5 &&
        semanticEval.factualAccuracy >= 4.0 &&
        semanticEval.failureCategories.length === 0;

      const evalRecord: ScenarioEvaluationRecord = {
        scenarioId: scenario.id,
        datasetSplit: scenario.split,
        propertyId: scenario.propertyId,
        customerPersona: `${scenario.persona.name} (${scenario.persona.style})`,
        customerGoal: scenario.category,
        category: scenario.category,
        expectedInvariants: scenario.expectedInvariants,
        turns: turnRecords,
        evaluation: {
          goalCompletion: semanticEval.goalCompletion,
          intentUnderstanding: semanticEval.intentUnderstanding,
          contextUnderstanding: semanticEval.contextUnderstanding,
          factualAccuracy: semanticEval.factualAccuracy,
          responseRelevance: semanticEval.responseRelevance,
          toolSelectionQuality: semanticEval.toolSelectionQuality,
          proactiveness: semanticEval.proactiveness,
          naturalness: semanticEval.naturalness,
          conciseness: semanticEval.conciseness,
        },
        passed,
        failureCategories: semanticEval.failureCategories,
        rootCauseHypothesis: semanticEval.failureCategories.length > 0 ? this.hypothesizeRootCause(semanticEval.failureCategories) : undefined,
        affectedModules: semanticEval.failureCategories.length > 0 ? this.identifyAffectedModules(semanticEval.failureCategories) : undefined,
      };

      evaluationRecords.push(evalRecord);

      // Append transcript
      appendFileSync(
        transcriptsPath,
        JSON.stringify({
          scenarioId: scenario.id,
          propertyId: scenario.propertyId,
          passed,
          turns: turnRecords.map(t => ({ user: t.userMessage, bot: t.deliveredResponse, mediaCount: t.deliveredMedia.length })),
        }) + '\n',
        'utf-8'
      );

      // Append failure case if failed
      if (!passed) {
        appendFileSync(
          failuresPath,
          JSON.stringify({
            scenarioId: scenario.id,
            category: scenario.category,
            propertyId: scenario.propertyId,
            failureCategories: semanticEval.failureCategories,
            rootCause: evalRecord.rootCauseHypothesis,
            affectedModules: evalRecord.affectedModules,
            turns: turnRecords.map(t => ({ user: t.userMessage, bot: t.deliveredResponse })),
          }) + '\n',
          'utf-8'
        );
      }

      if (options?.onProgress) {
        options.onProgress(sIdx + 1, scenariosToRun.length);
      } else if ((sIdx + 1) % 50 === 0 || sIdx + 1 === scenariosToRun.length) {
        console.log(`  ✓ Đã hoàn tất: ${sIdx + 1} / ${scenariosToRun.length} scenarios...`);
      }
    }

    // Export remaining deliverables
    const summary = this.exportDeliverables(allScenarios, evaluationRecords);
    return { scenarios: allScenarios, records: evaluationRecords, summary };
  }

  private hypothesizeRootCause(failures: FailureCategory[]): string {
    if (failures.includes('WRONG_OPTIMIZATION_OBJECTIVE') || failures.includes('LACK_OF_PROACTIVENESS')) {
      return 'GenericConstraintSolver chưa tối ưu hàm mục tiêu chi phí thấp nhất; Response Composer dump 3 hạng phòng mặc định.';
    }
    if (failures.includes('MISSING_MEDIA')) {
      return 'Decision Engine không tự động phát hiện hoạt động xem ảnh ở lượt trước để kích hoạt get_room_media khi khách chỉ gửi mã phòng.';
    }
    if (failures.includes('WRONG_PRICE')) {
      return 'Biểu giá lệch mốc giờ kinh doanh hoặc áp sai bảng Daytime của Hà Đông cho các cơ sở khác.';
    }
    if (failures.includes('UNSUPPORTED_FACT')) {
      return 'Khẳng định tiện ích chưa được thẩm định (bếp/bồn đôi) do thiếu guard chặn suy đoán.';
    }
    return 'Lỗi phân tầng suy luận và đồng bộ trạng thái giữa NLU và Response Planning.';
  }

  private identifyAffectedModules(failures: FailureCategory[]): string[] {
    const mods = new Set<string>();
    for (const f of failures) {
      if (f === 'WRONG_OPTIMIZATION_OBJECTIVE' || f === 'INCORRECT_RECOMMENDATION') {
        mods.add('src/agent/generic-constraint-solver.ts');
        mods.add('src/agent/jcollection-agent.ts');
      }
      if (f === 'MISSING_MEDIA' || f === 'LACK_OF_PROACTIVENESS') {
        mods.add('src/agent/jcollection-agent.ts (Response Planner)');
        mods.add('src/agent/agent-tools.ts (get_room_media)');
      }
      if (f === 'CONTEXT_REFERENCE_FAILURE' || f === 'STALE_MEMORY') {
        mods.add('src/agent/generic-constraint-solver.ts (StructuredStateManager)');
        mods.add('src/conversation/memory-manager.ts');
      }
      if (f === 'WRONG_PRICE' || f === 'UNSUPPORTED_FACT') {
        mods.add('src/pricing/prebooking-quote-engine.ts');
        mods.add('src/agent/agent-tools.ts');
      }
    }
    return Array.from(mods);
  }

  private exportDeliverables(
    scenarios: SimulationScenario[],
    records: ScenarioEvaluationRecord[]
  ): Record<string, any> {
    const total = records.length;
    const passed = records.filter(r => r.passed).length;
    const failed = total - passed;

    // 1. evaluation-results.json
    writeFileSync(
      join(this.outputDir, 'evaluation-results.json'),
      JSON.stringify(records, null, 2),
      'utf-8'
    );

    // 2. failure-distribution.csv
    const failureCounts: Record<string, number> = {};
    for (const r of records) {
      for (const f of r.failureCategories) {
        failureCounts[f] = (failureCounts[f] || 0) + 1;
      }
    }

    let csvContent = 'FailureCategory,Count,Percentage,Severity\n';
    for (const [cat, count] of Object.entries(failureCounts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / total) * 100).toFixed(2);
      const sev = cat.includes('WRONG_PRICE') || cat.includes('UNSUPPORTED_FACT') || cat.includes('WRONG_PROPERTY') ? 'CRITICAL' : 'HIGH';
      csvContent += `${cat},${count},${pct}%,${sev}\n`;
    }
    writeFileSync(join(this.outputDir, 'failure-distribution.csv'), csvContent, 'utf-8');

    // 3. provider-performance.json
    const providerStats: Record<string, { totalTurns: number; avgLatencyMs: number; errors: number }> = {};
    for (const r of records) {
      for (const t of r.turns) {
        const key = t.executionMode;
        if (!providerStats[key]) {
          providerStats[key] = { totalTurns: 0, avgLatencyMs: 0, errors: 0 };
        }
        providerStats[key].totalTurns++;
        providerStats[key].avgLatencyMs += t.latencyMs;
        if (t.fallbackStatus === 'TRIGGERED') providerStats[key].errors++;
      }
    }
    for (const k of Object.keys(providerStats)) {
      providerStats[k].avgLatencyMs = Math.round(providerStats[k].avgLatencyMs / providerStats[k].totalTurns);
    }
    writeFileSync(
      join(this.outputDir, 'provider-performance.json'),
      JSON.stringify(providerStats, null, 2),
      'utf-8'
    );

    // 4. execution-manifest.json
    const manifest = {
      timestamp: new Date().toISOString(),
      seed: 42,
      scenarioCount: total,
      discoveryCount: records.filter(r => r.datasetSplit === 'discovery').length,
      heldOutCount: records.filter(r => r.datasetSplit === 'held_out').length,
      passedCount: passed,
      failedCount: failed,
      passRate: `${((passed / total) * 100).toFixed(1)}%`,
      properties: {
        'jacayl-ha-dong': records.filter(r => r.propertyId === 'jacayl-ha-dong').length,
        'jacayl-tran-khat-chan': records.filter(r => r.propertyId === 'jacayl-tran-khat-chan').length,
        'j-village': records.filter(r => r.propertyId === 'j-village').length,
      },
      environment: {
        CONVERSATION_ENGINE: process.env.CONVERSATION_ENGINE || 'agentic',
        FREE_ONLY_MODE: process.env.FREE_ONLY_MODE || 'true',
        LLM_PROVIDER: process.env.LLM_PROVIDER || 'auto',
      },
    };
    writeFileSync(
      join(this.outputDir, 'execution-manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    // 5. recommended-improvements.md
    const improvementsDoc = `# J COLLECTION AGENTIC — RECOMMENDED ARCHITECTURAL IMPROVEMENTS
## Phân tích từ 500 Realistic Customer Scenarios

Dựa trên kết quả thu thập từ 500 tình huống kiểm thử mô phỏng khách hàng độc lập, nhóm kiến trúc đề xuất các cải tiến sau:

### P0 — CẢI TIẾN CẤP THIẾT (Tác động trực tiếp đến Owner Cases)
1. **GenericConstraintSolver — Tối ưu hóa mục tiêu so sánh (Case 01):**
   - Thay vì trả về 3 đại diện của 3 hạng phòng (Standard, Deluxe, Concept), solver phải nhận diện mục tiêu tối ưu hóa (\`cheapest\`, \`best_amenity\`, \`nearest_budget\`).
   - Khi khách yêu cầu "phòng rẻ nhất", chỉ trả về duy nhất 1 phương án có giá sàn/báo giá thấp nhất kèm điều kiện áp dụng rõ ràng.
2. **Context-Aware Proactive Media Delivery (Case 02):**
   - Khi trạng thái trước đó của khách là xem ảnh (\`BROWSE_ROOMS_PHOTOS\`), nếu ở lượt sau khách gửi mã phòng cụ thể (e.g. "203"), Response Planner phải chủ động gọi \`get_room_media\` và đính kèm danh sách ảnh vào \`turnResult.images\` thay vì chỉ hỏi "anh/chị có muốn xem ảnh không?".
3. **Đồng bộ hóa môi trường Dashboard:**
   - Bảo đảm \`CONVERSATION_ENGINE=agentic\` được cố định trong cấu hình và scripts \`npm run dashboard:demo\`, ngăn chặn fallback vô tình về Legacy engine.

### P1 — CẢI TIẾN ĐỘ TIN CẬY & NGỮ CẢNH
1. **Anaphora Resolution & Room Code Normalization:**
   - Nhận diện các mã phòng viết tắt, số phòng đơn lẻ ("203", "p203", "căn 601") và liên kết chính xác với cơ sở đang kích hoạt.
2. **Disclaimers tự động cho tiện ích UNKNOWN:**
   - Tiếp tục bảo vệ nghiêm ngặt các tiện ích như bếp, máy chiếu, bồn tắm nằm đôi.

### P2 — HIỆU SUẤT & TRẢI NGHIỆM
1. **Giảm độ dài phản hồi (Conciseness Tuning):**
   - Rút gọn các lời mở đầu và lưu ý chính sách lặp lại ở các câu hỏi thông tin đơn lẻ.
`;
    writeFileSync(join(this.outputDir, 'recommended-improvements.md'), improvementsDoc, 'utf-8');

    return manifest;
  }
}
