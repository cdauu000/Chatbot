import { RawRoomCategory, StayType } from '../domain/types.js';
import {
  AgentState,
  RecommendationCandidate,
  RecommendationSolveResult,
  ExplicitUserConstraints,
  OptimizationGoal,
  ConversationActivityType,
} from './agent-contracts.js';

/**
 * State Management Operations for Structured Agent State (Section VII).
 * Supports Add, Update, Retract, Reinstate, and Invalidate.
 */
export class StructuredStateManager {
  /**
   * Sets or updates conversation activity (VIEWING_PHOTOS, SEARCHING, COMPARING_PRICES, etc.).
   */
  public static setActivity(state: AgentState, activity: ConversationActivityType): void {
    state.currentActivity = activity;
  }

  /**
   * Sets optimization goal (CHEAPEST, BEST_BUDGET_FIT, etc.).
   */
  public static setOptimizationGoal(state: AgentState, goal: OptimizationGoal): void {
    state.optimizationGoal = goal;
  }
  /**
   * Adds or updates a hard constraint in state.
   */
  public static updateConstraint<K extends keyof ExplicitUserConstraints>(
    state: AgentState,
    key: K,
    value: ExplicitUserConstraints[K]
  ): void {
    if (!state.explicitConstraints) {
      state.explicitConstraints = {
        requiredAmenities: [...state.hardConstraints.requiredAmenities],
        budget: state.hardConstraints.budget,
        durationHours: state.hardConstraints.durationHours,
        stayType: state.hardConstraints.stayType,
        checkinDatetime: state.hardConstraints.checkinDatetime,
      };
    }

    state.explicitConstraints[key] = value;

    // Mirror to hardConstraints for backward compatibility
    if (key === 'budget') state.hardConstraints.budget = value as number | undefined;
    if (key === 'durationHours') state.hardConstraints.durationHours = value as number | undefined;
    if (key === 'stayType') state.hardConstraints.stayType = value as StayType | undefined;
    if (key === 'checkinDatetime') state.hardConstraints.checkinDatetime = value as string | undefined;
    if (key === 'requiredAmenities') state.hardConstraints.requiredAmenities = (value as string[]) || [];

    // Invalidate quotes when core stay parameters change
    if (['budget', 'durationHours', 'stayType', 'checkinDatetime'].includes(key as string)) {
      this.invalidateQuotes(state, `Constraint ${String(key)} changed`);
    }
  }

  /**
   * Retracts a constraint (e.g. customer says "thôi không lấy bồn tắm nữa").
   */
  public static retractConstraint(state: AgentState, amenityOrKey: string): void {
    if (state.hardConstraints.requiredAmenities.includes(amenityOrKey)) {
      state.hardConstraints.requiredAmenities = state.hardConstraints.requiredAmenities.filter(
        (a) => a !== amenityOrKey
      );
    }
    if (state.explicitConstraints?.requiredAmenities.includes(amenityOrKey)) {
      state.explicitConstraints.requiredAmenities = state.explicitConstraints.requiredAmenities.filter(
        (a) => a !== amenityOrKey
      );
    }
    this.invalidateQuotes(state, `Retracted amenity constraint: ${amenityOrKey}`);
  }

  /**
   * Rejects a room choice (e.g. customer says "không lấy phòng 101").
   */
  public static rejectChoice(state: AgentState, roomId: string): void {
    state.negatedRoomIds = state.negatedRoomIds || [];
    state.rejectedChoices = state.rejectedChoices || [];

    if (!state.negatedRoomIds.includes(roomId)) {
      state.negatedRoomIds.push(roomId);
    }
    if (!state.rejectedChoices.includes(roomId)) {
      state.rejectedChoices.push(roomId);
    }

    // Remove from reinstated if present
    if (state.reinstatedChoices) {
      state.reinstatedChoices = state.reinstatedChoices.filter((id) => id !== roomId);
    }

    this.invalidateQuotes(state, `Rejected room: ${roomId}`);
  }

  /**
   * Reinstates a previously rejected choice (Section VII: customer changes mind and wants room back).
   */
  public static reinstateChoice(state: AgentState, roomId: string): void {
    state.negatedRoomIds = (state.negatedRoomIds || []).filter((id) => id !== roomId);
    state.rejectedChoices = (state.rejectedChoices || []).filter((id) => id !== roomId);

    state.reinstatedChoices = state.reinstatedChoices || [];
    if (!state.reinstatedChoices.includes(roomId)) {
      state.reinstatedChoices.push(roomId);
    }
  }

  /**
   * Invalidate quote references when stay parameters change to avoid stale pricing.
   */
  public static invalidateQuotes(state: AgentState, reason: string): void {
    state.validQuoteReferences = [];
    state.lastQuotes = [];
    if (!state.decisionSteps) state.decisionSteps = [];
    state.decisionSteps.push({
      step: state.decisionSteps.length + 1,
      phase: 'REVISE',
      thoughtSummary: `Invalidate old quotes: ${reason}`,
    });
  }
}

/**
 * Generic Recommendation & Constraint Solver (Section VI).
 * Solves customer constraints dynamically without hardcoding room IDs.
 */
export class GenericConstraintSolver {
  /**
   * Solves room candidates against customer constraints and actual quotes.
   */
  public static solve(params: {
    candidatePool: any[];
    quotes: any[];
    maxBudget?: number;
    requiredAmenities: string[];
    softPreferences?: string[];
    goal?: OptimizationGoal;
  }): RecommendationSolveResult {
    const { candidatePool, quotes, maxBudget, requiredAmenities, softPreferences = [], goal = 'BEST_BUDGET_FIT' } = params;

    if (quotes.length === 0) {
      return {
        alternativeOptions: [],
        allEvaluated: [],
        summary: 'No active quotes available for constraint solving.',
      };
    }

    // Map each quote to a RecommendationCandidate
    const evaluated: RecommendationCandidate[] = quotes.map((q) => {
      const roomCand = candidatePool.find((c) => c.room_id === q.room_id);
      const confirmedAmenities = roomCand?.confirmed_amenities || [];
      const totalVnd = q.total_price_vnd ?? 0;
      const isWithinBudget = !maxBudget || totalVnd <= maxBudget;
      const budgetDeltaVnd = maxBudget && totalVnd > maxBudget ? totalVnd - maxBudget : 0;

      return {
        roomId: q.room_id,
        roomName: q.room_name,
        category: (q.category as RawRoomCategory) || 'Standard',
        totalPriceVnd: totalVnd,
        priceBreakdown: q.price_breakdown_text || '',
        confirmedAmenities,
        isWithinBudget,
        budgetDeltaVnd,
        role: isWithinBudget ? 'OPTIMAL_WITHIN_BUDGET' : 'TRANSPARENT_UPGRADE',
        justification: '',
      };
    });

    // Special Case: CHEAPEST optimization goal (Owner Case 01)
    if (goal === 'CHEAPEST') {
      const sortedByPrice = [...evaluated].sort((a, b) => a.totalPriceVnd - b.totalPriceVnd);
      const cheapest = sortedByPrice[0];
      cheapest.role = 'OPTIMAL_WITHIN_BUDGET';
      cheapest.justification = `Phương án có mức giá thấp nhất (${cheapest.totalPriceVnd.toLocaleString('vi-VN')}đ).`;

      // Any other rooms with the exact same lowest price can be alternative options, but do NOT force upgrade
      const alternatives = sortedByPrice.slice(1).filter((c) => c.totalPriceVnd === cheapest.totalPriceVnd);

      return {
        primaryOption: cheapest,
        upgradeOption: undefined, // Never force upgrade when customer asked for cheapest!
        alternativeOptions: alternatives,
        allEvaluated: evaluated,
        summary: `Cheapest option resolved: ${cheapest.roomName} (${cheapest.totalPriceVnd}đ)`,
      };
    }

    const withinBudget = evaluated
      .filter((c) => c.isWithinBudget)
      .sort((a, b) => a.totalPriceVnd - b.totalPriceVnd);

    const overBudget = evaluated
      .filter((c) => !c.isWithinBudget)
      .sort((a, b) => a.totalPriceVnd - b.totalPriceVnd);

    let primaryOption: RecommendationCandidate | undefined;
    let upgradeOption: RecommendationCandidate | undefined;
    const alternativeOptions: RecommendationCandidate[] = [];

    if (withinBudget.length > 0 && overBudget.length > 0) {
      // Primary is the best option fitting inside budget
      primaryOption = withinBudget[0];
      primaryOption.role = 'OPTIMAL_WITHIN_BUDGET';
      primaryOption.justification = `Phương án tối ưu nằm gọn trong ngân sách (${primaryOption.totalPriceVnd.toLocaleString('vi-VN')}đ).`;

      // Compare primary within-budget option with over-budget option if present
      upgradeOption = overBudget[overBudget.length - 1];
      upgradeOption.role = 'TRANSPARENT_UPGRADE';
      upgradeOption.justification = `Phương án nâng cấp cao nhất (vượt ngân sách ${upgradeOption.budgetDeltaVnd.toLocaleString('vi-VN')}đ).`;

      // Any remaining candidates are alternatives
      for (const item of evaluated) {
        if (item !== primaryOption && item !== upgradeOption) {
          item.role = 'ALTERNATIVE_OPTION';
          alternativeOptions.push(item);
        }
      }
    } else if (withinBudget.length > 0) {
      primaryOption = withinBudget[0];
      primaryOption.role = 'OPTIMAL_WITHIN_BUDGET';
      primaryOption.justification = 'Phù hợp ngân sách của khách hàng.';

      if (goal === 'BALANCED_UPGRADE' && withinBudget.length > 1) {
        upgradeOption = withinBudget[withinBudget.length - 1];
        upgradeOption.role = 'TRANSPARENT_UPGRADE';
        upgradeOption.justification = 'Lựa chọn hạng cao hơn trong cùng ngân sách.';
      }
      for (const item of withinBudget.slice(1)) {
        if (item !== upgradeOption) {
          item.role = 'ALTERNATIVE_OPTION';
          alternativeOptions.push(item);
        }
      }
    } else {
      primaryOption = overBudget[0];
      primaryOption.role = 'OPTIMAL_WITHIN_BUDGET';
      primaryOption.justification = `Mức giá tốt nhất hiện có (vượt ngân sách ${primaryOption.budgetDeltaVnd.toLocaleString('vi-VN')}đ).`;

      if (overBudget.length > 1) {
        upgradeOption = overBudget[overBudget.length - 1];
        upgradeOption.role = 'TRANSPARENT_UPGRADE';
        upgradeOption.justification = `Hạng cao cấp nhất (vượt ngân sách ${upgradeOption.budgetDeltaVnd.toLocaleString('vi-VN')}đ).`;
      }
      for (const item of overBudget.slice(1)) {
        if (item !== upgradeOption) {
          item.role = 'ALTERNATIVE_OPTION';
          alternativeOptions.push(item);
        }
      }
    }

    const summary = primaryOption
      ? `Primary: ${primaryOption.roomName} (${primaryOption.totalPriceVnd}đ)${upgradeOption ? `, Upgrade: ${upgradeOption.roomName} (${upgradeOption.totalPriceVnd}đ)` : ''}`
      : 'No recommendations resolved';

    return {
      primaryOption,
      upgradeOption,
      alternativeOptions,
      allEvaluated: evaluated,
      summary,
    };
  }
}
