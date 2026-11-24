/**
 * J Collection AI Concierge - Milestone 4.3 Autonomous Testing Lab
 * Conversation Evaluator for Invariant Checking & Multi-turn Coherence
 */

import { ConversationOrchestrator } from '../../conversation/orchestrator.js';
import { ConversationTurnResult, WorkingMemory } from '../../conversation/conversation-types.js';
import { GeneratedTurn, MultiTurnScenario } from './scenario-generator.js';
import { FailureClassifier, FailureCategory } from './failure-classifier.js';

export interface TurnEvaluation {
  userMessage: string;
  response: string;
  passed: boolean;
  failureCategory: FailureCategory | null;
  violatedInvariants: string[];
  coherenceScore: number; // 0 - 100
  accuracyScore: number; // 0 - 100
  brevityScore: number; // 0 - 100
}

export interface ScenarioEvaluationResult {
  scenarioId: string;
  facility: string;
  passed: boolean;
  totalTurns: number;
  passedTurns: number;
  failureCategories: FailureCategory[];
  turnEvaluations: TurnEvaluation[];
  overallCoherence: number;
  overallAccuracy: number;
  overallBrevity: number;
}

export class ConversationEvaluator {
  private classifier: FailureClassifier;

  constructor() {
    this.classifier = new FailureClassifier();
  }

  /**
   * Evaluates a single turn execution against conversation invariants.
   */
  public evaluateTurn(
    turn: GeneratedTurn,
    result: ConversationTurnResult,
    memory: WorkingMemory
  ): TurnEvaluation {
    const text = result.customer_visible_response || '';
    const violatedInvariants: string[] = [];
    let brevityScore = 100;
    let accuracyScore = 100;
    let coherenceScore = 100;

    // Invariant 1: Canonical Room Identity
    if (/601 — 50 — Sắc Thái|101 — 101 — Lồng Chim/i.test(text)) {
      violatedInvariants.push('CANONICAL_IDENTITY_DUPLICATE_PREFIX');
      accuracyScore -= 40;
    }

    // Invariant 2: Grounded Fact - Bathtub twin check
    if (
      turn.userMessage.toLowerCase().includes('bồn đôi') &&
      text.toLowerCase().includes('bồn tắm đôi') &&
      !text.includes('chưa có thông tin') &&
      !text.includes('chưa được công bố') &&
      !text.includes('chưa xác nhận') &&
      !text.includes('bồn tắm lớn')
    ) {
      violatedInvariants.push('UNGROUNDED_TWIN_BATHTUB');
      accuracyScore -= 50;
    }

    // Invariant 3: Grounded Fact - Parking check
    if (/bãi đỗ ô tô rộng rãi ngay trước cửa/i.test(text)) {
      violatedInvariants.push('UNGROUNDED_PARKING_CLAIM');
      accuracyScore -= 50;
    }

    // Invariant 4: No unverified SLA promises
    if (/(trong (vài|ít|[0-9]+) phút|nhân viên sẽ liên hệ ngay lập tức)/i.test(text)) {
      violatedInvariants.push('UNVERIFIED_TAKEOVER_SLA');
      accuracyScore -= 30;
    }

    // Invariant 5: Natural Response Policy - No unsolicited room dumps on polite closing or direct fact
    if (
      (turn.expectedGoal === 'POLITE_CLOSING' || turn.archetype?.includes('POLITE_CLOSING')) &&
      (/dưới đây là danh sách|bảng giá phòng|phòng 101|phòng 201/i.test(text) || text.length > 250)
    ) {
      violatedInvariants.push('UNSOLICITED_SALES_ON_POLITE_CLOSING');
      brevityScore -= 60;
    }

    if (
      (turn.expectedGoal === 'ANSWER_DIRECT_FACT' || turn.expectedGoal === 'ANSWER_POLICY') &&
      (/dưới đây là các phòng|bảng giá phòng đầy đủ/i.test(text) || text.length > 550)
    ) {
      violatedInvariants.push('UNSOLICITED_ROOM_CATALOG_ON_SINGLE_FACT');
      brevityScore -= 40;
    }

    // Invariant 6: Expected snippet inclusion
    if (turn.expectedResponseSnippet && !text.toLowerCase().includes(turn.expectedResponseSnippet.toLowerCase())) {
      violatedInvariants.push(`MISSING_EXPECTED_SNIPPET: "${turn.expectedResponseSnippet}"`);
      accuracyScore -= 30;
    }

    // Invariant 7: Forbidden snippet exclusion
    if (turn.forbiddenResponseSnippets) {
      for (const forbidden of turn.forbiddenResponseSnippets) {
        if (text.toLowerCase().includes(forbidden.toLowerCase())) {
          violatedInvariants.push(`CONTAINS_FORBIDDEN_SNIPPET: "${forbidden}"`);
          accuracyScore -= 30;
        }
      }
    }

    // Invariant 8: Context resolution
    const activeRoomCode = memory.focused_room?.ma_phong;
    if (
      turn.expectedRoomCode &&
      activeRoomCode &&
      activeRoomCode !== turn.expectedRoomCode
    ) {
      violatedInvariants.push(`CONTEXT_ROOM_MISMATCH: expected ${turn.expectedRoomCode}, got ${activeRoomCode}`);
      coherenceScore -= 40;
    }

    // Run failure classifier
    const failureCategory = this.classifier.classify({
      userMessage: turn.userMessage,
      actualGoal: result.plan?.primaryGoal,
      expectedGoal: turn.expectedGoal,
      actualResponse: text,
      activeRoom: activeRoomCode,
      expectedRoomCode: turn.expectedRoomCode,
      activeFacility: memory.active_facility || undefined,
      expectedFacility: turn.expectedFacility,
      forbiddenSnippets: turn.forbiddenResponseSnippets,
      expectedPriceSnippet: turn.expectedResponseSnippet?.includes('đ') ? turn.expectedResponseSnippet : undefined,
    });

    const passed = violatedInvariants.length === 0 && failureCategory === null;

    return {
      userMessage: turn.userMessage,
      response: text,
      passed,
      failureCategory,
      violatedInvariants,
      coherenceScore: Math.max(0, coherenceScore),
      accuracyScore: Math.max(0, accuracyScore),
      brevityScore: Math.max(0, brevityScore),
    };
  }

  /**
   * Executes a multi-turn scenario chain and evaluates all turns in sequence.
   */
  public async evaluateScenario(
    scenario: MultiTurnScenario,
    orchestrator: ConversationOrchestrator
  ): Promise<ScenarioEvaluationResult> {
    const sessionId = `eval-${scenario.id}-${Date.now()}`;
    const turnEvaluations: TurnEvaluation[] = [];
    const failureCategories: FailureCategory[] = [];

    let passedTurns = 0;
    let sumCoherence = 0;
    let sumAccuracy = 0;
    let sumBrevity = 0;

    for (const turn of scenario.turns) {
      const result = await orchestrator.processTurn(sessionId, turn.userMessage, undefined, scenario.facility);
      const memory = result.updated_state;
      const evalTurn = this.evaluateTurn(turn, result, memory);

      turnEvaluations.push(evalTurn);
      sumCoherence += evalTurn.coherenceScore;
      sumAccuracy += evalTurn.accuracyScore;
      sumBrevity += evalTurn.brevityScore;

      if (evalTurn.passed) {
        passedTurns++;
      } else if (evalTurn.failureCategory) {
        failureCategories.push(evalTurn.failureCategory);
      }
    }

    const totalTurns = scenario.turns.length;
    const passed = passedTurns === totalTurns;

    return {
      scenarioId: scenario.id,
      facility: scenario.facility,
      passed,
      totalTurns,
      passedTurns,
      failureCategories,
      turnEvaluations,
      overallCoherence: Math.round(sumCoherence / totalTurns),
      overallAccuracy: Math.round(sumAccuracy / totalTurns),
      overallBrevity: Math.round(sumBrevity / totalTurns),
    };
  }

  public getClassifier(): FailureClassifier {
    return this.classifier;
  }
}
