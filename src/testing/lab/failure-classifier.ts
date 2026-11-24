/**
 * J Collection AI Concierge - Milestone 4.3 Autonomous Testing Lab
 * Failure Classifier across 13 Canonical Defect Categories
 */

export type FailureCategory =
  | 'INTENT_MISCLASSIFICATION'
  | 'CONTEXT_REFERENCE_FAILURE'
  | 'MEMORY_CONTAMINATION'
  | 'UNSOLICITED_INFORMATION'
  | 'UNVERIFIED_FACT'
  | 'PRICING_INCONSISTENCY'
  | 'WRONG_PROPERTY'
  | 'WRONG_ROOM_IDENTITY'
  | 'IMAGE_MISMATCH'
  | 'HALLUCINATED_ACTION'
  | 'OVER_VERBOSE_RESPONSE'
  | 'UNNECESSARY_CLARIFICATION'
  | 'HUMAN_TAKEOVER_FAILURE';

export interface FailureDefinition {
  category: FailureCategory;
  name: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export const CANONICAL_FAILURE_DEFINITIONS: Record<FailureCategory, FailureDefinition> = {
  INTENT_MISCLASSIFICATION: {
    category: 'INTENT_MISCLASSIFICATION',
    name: 'Intent Misclassification',
    description: 'System misinterpreted primary customer goal (e.g. treated polite closing or single fact as discovery search).',
    severity: 'HIGH',
  },
  CONTEXT_REFERENCE_FAILURE: {
    category: 'CONTEXT_REFERENCE_FAILURE',
    name: 'Context Reference Failure',
    description: 'Failed to resolve anaphoric or contextual reference to active room or property from preceding turn.',
    severity: 'HIGH',
  },
  MEMORY_CONTAMINATION: {
    category: 'MEMORY_CONTAMINATION',
    name: 'Memory Contamination',
    description: 'Carried forward stale or superseded constraints after customer switched topic, category, or facility.',
    severity: 'HIGH',
  },
  UNSOLICITED_INFORMATION: {
    category: 'UNSOLICITED_INFORMATION',
    name: 'Unsolicited Information',
    description: 'Included unprompted room catalogs, pricing lists, or marketing sales pitch in direct single-fact or polite closing answers.',
    severity: 'MEDIUM',
  },
  UNVERIFIED_FACT: {
    category: 'UNVERIFIED_FACT',
    name: 'Unverified Fact',
    description: 'Asserted ungrounded amenities, fake twin bathtubs, unverified parking features, or ungrounded SLA arrival times.',
    severity: 'CRITICAL',
  },
  PRICING_INCONSISTENCY: {
    category: 'PRICING_INCONSISTENCY',
    name: 'Pricing Inconsistency',
    description: 'Calculated or quoted price deviating from Business Policy V1.4.3 or applied wrong time/category surcharge tier.',
    severity: 'CRITICAL',
  },
  WRONG_PROPERTY: {
    category: 'WRONG_PROPERTY',
    name: 'Wrong Property',
    description: 'Offered or searched rooms belonging to a different facility than specified or actively discussed.',
    severity: 'CRITICAL',
  },
  WRONG_ROOM_IDENTITY: {
    category: 'WRONG_ROOM_IDENTITY',
    name: 'Wrong Room Identity',
    description: 'Violated canonical room identity (prepended room numbers, altered accents, or conflated concept category with pricing category).',
    severity: 'CRITICAL',
  },
  IMAGE_MISMATCH: {
    category: 'IMAGE_MISMATCH',
    name: 'Image Mismatch',
    description: 'Returned photos not matching the requested room or included broken/unverified image URLs.',
    severity: 'HIGH',
  },
  HALLUCINATED_ACTION: {
    category: 'HALLUCINATED_ACTION',
    name: 'Hallucinated Action',
    description: 'Claimed booking was created, payment processed, or PMS updated when no such backend capability exists.',
    severity: 'CRITICAL',
  },
  OVER_VERBOSE_RESPONSE: {
    category: 'OVER_VERBOSE_RESPONSE',
    name: 'Over-Verbose Response',
    description: 'Exceeded response depth limits or lectured customer when a single concise fact was requested.',
    severity: 'LOW',
  },
  UNNECESSARY_CLARIFICATION: {
    category: 'UNNECESSARY_CLARIFICATION',
    name: 'Unnecessary Clarification',
    description: 'Pestered customer with questions when query was already clear or customer was trying to conclude conversation.',
    severity: 'MEDIUM',
  },
  HUMAN_TAKEOVER_FAILURE: {
    category: 'HUMAN_TAKEOVER_FAILURE',
    name: 'Human Takeover Failure',
    description: 'Failed to acknowledge staff handoff or made false promises like "nhân viên sẽ gọi lại trong 2 phút".',
    severity: 'HIGH',
  },
};

export interface DiagnosticTurnInput {
  userMessage: string;
  actualGoal?: string;
  expectedGoal?: string;
  actualResponse: string;
  activeRoom?: string;
  expectedRoomCode?: string;
  activeFacility?: string;
  expectedFacility?: string;
  hasPriceCalculation?: boolean;
  expectedPriceSnippet?: string;
  forbiddenSnippets?: string[];
  responseLength?: number;
  unsolicitedRoomDumping?: boolean;
  hallucinatedPromises?: boolean;
}

export class FailureClassifier {
  private failureCounts: Record<FailureCategory, number>;

  constructor() {
    this.failureCounts = {
      INTENT_MISCLASSIFICATION: 0,
      CONTEXT_REFERENCE_FAILURE: 0,
      MEMORY_CONTAMINATION: 0,
      UNSOLICITED_INFORMATION: 0,
      UNVERIFIED_FACT: 0,
      PRICING_INCONSISTENCY: 0,
      WRONG_PROPERTY: 0,
      WRONG_ROOM_IDENTITY: 0,
      IMAGE_MISMATCH: 0,
      HALLUCINATED_ACTION: 0,
      OVER_VERBOSE_RESPONSE: 0,
      UNNECESSARY_CLARIFICATION: 0,
      HUMAN_TAKEOVER_FAILURE: 0,
    };
  }

  /**
   * Diagnoses a conversation turn and returns the most prominent FailureCategory if any failure occurred.
   */
  public classify(input: DiagnosticTurnInput): FailureCategory | null {
    const text = input.actualResponse;

    // 1. Hallucinated Action check
    if (
      input.hallucinatedPromises ||
      /đã (đặt|thanh toán|giữ) phòng thành công|đã ghi nhận booking trên hệ thống PMS/i.test(text)
    ) {
      this.record('HALLUCINATED_ACTION');
      return 'HALLUCINATED_ACTION';
    }

    // 2. Human Takeover Failure
    if (
      input.expectedGoal === 'REQUEST_STAFF_HANDOFF' &&
      /(trong (vài|ít|[0-9]+) phút|nhân viên sẽ liên hệ ngay lập tức)/i.test(text)
    ) {
      this.record('HUMAN_TAKEOVER_FAILURE');
      return 'HUMAN_TAKEOVER_FAILURE';
    }

    // 3. Wrong Room Identity
    if (
      /601 — 50 — Sắc Thái|101 — 101 — Lồng Chim/i.test(text) ||
      (input.expectedRoomCode === '601-50-sac-thai' && text.includes('Phòng Suite') && !text.includes('50 — Sắc Thái'))
    ) {
      this.record('WRONG_ROOM_IDENTITY');
      return 'WRONG_ROOM_IDENTITY';
    }

    // 4. Wrong Property
    if (
      input.expectedFacility &&
      input.activeFacility &&
      input.expectedFacility !== input.activeFacility
    ) {
      this.record('WRONG_PROPERTY');
      return 'WRONG_PROPERTY';
    }

    // 5. Pricing Inconsistency
    if (input.expectedPriceSnippet && !text.includes(input.expectedPriceSnippet)) {
      if (/\b\d{3}\.000\b/i.test(text) || text.includes('đ') || text.includes('k')) {
        this.record('PRICING_INCONSISTENCY');
        return 'PRICING_INCONSISTENCY';
      }
    }

    // 6. Unverified Fact
    if (
      /bãi đỗ ô tô rộng rãi ngay trước cửa/i.test(text) ||
      (/(có|trang bị)\s+bồn tắm đôi/i.test(text) &&
        !text.includes('chưa có thông tin') &&
        !text.includes('chưa được công bố') &&
        !text.includes('chưa xác nhận'))
    ) {
      this.record('UNVERIFIED_FACT');
      return 'UNVERIFIED_FACT';
    }

    // 7. Unsolicited Information (e.g. dumping room listings on polite closing or single fact)
    if (
      input.unsolicitedRoomDumping ||
      (input.expectedGoal === 'POLITE_CLOSING' &&
        (/dưới đây là danh sách|bảng giá phòng|phòng 101|phòng 201/i.test(text) || text.length > 250)) ||
      (input.expectedGoal === 'ANSWER_DIRECT_FACT' &&
        (/dưới đây là các phòng|bảng giá phòng đầy đủ/i.test(text) || text.length > 500))
    ) {
      this.record('UNSOLICITED_INFORMATION');
      return 'UNSOLICITED_INFORMATION';
    }

    // 8. Over-verbose response
    if (input.expectedGoal === 'POLITE_CLOSING' && text.length > 300) {
      this.record('OVER_VERBOSE_RESPONSE');
      return 'OVER_VERBOSE_RESPONSE';
    }

    // 9. Context Reference Failure
    if (
      input.expectedRoomCode &&
      !input.activeRoom &&
      (input.userMessage.includes('phòng này') || input.userMessage.includes('ở đây'))
    ) {
      this.record('CONTEXT_REFERENCE_FAILURE');
      return 'CONTEXT_REFERENCE_FAILURE';
    }

    // 10. Memory Contamination (e.g., switched category to Deluxe but still answering with Suite/Concept)
    if (
      input.userMessage.toLowerCase().includes('đổi sang hạng deluxe') &&
      text.toLowerCase().includes('sắc thái') &&
      !text.toLowerCase().includes('deluxe')
    ) {
      this.record('MEMORY_CONTAMINATION');
      return 'MEMORY_CONTAMINATION';
    }

    // 11. Intent Misclassification
    if (input.expectedGoal && input.actualGoal && input.expectedGoal !== input.actualGoal) {
      this.record('INTENT_MISCLASSIFICATION');
      return 'INTENT_MISCLASSIFICATION';
    }

    // Check forbidden snippets
    if (input.forbiddenSnippets) {
      for (const snippet of input.forbiddenSnippets) {
        if (text.toLowerCase().includes(snippet.toLowerCase())) {
          this.record('UNSOLICITED_INFORMATION');
          return 'UNSOLICITED_INFORMATION';
        }
      }
    }

    return null;
  }

  private record(category: FailureCategory): void {
    this.failureCounts[category]++;
  }

  public getCounts(): Record<FailureCategory, number> {
    return { ...this.failureCounts };
  }

  public getTotalFailures(): number {
    return Object.values(this.failureCounts).reduce((acc, count) => acc + count, 0);
  }

  public reset(): void {
    for (const key of Object.keys(this.failureCounts) as FailureCategory[]) {
      this.failureCounts[key] = 0;
    }
  }
}
