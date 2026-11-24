import { CoSoMa, StayType, CompositeRoomKey, RawRoomCategory } from '../domain/types.js';
import {
  WorkingMemory,
  ExtractedEntities,
  ShortlistedRoomItem,
} from './conversation-types.js';

export interface MemoryManagerConfig {
  sessionTtlMs?: number; // default: 30 minutes
}

export class MemoryManager {
  private sessions: Map<string, WorkingMemory> = new Map();
  private sessionTtlMs: number;

  constructor(config?: MemoryManagerConfig) {
    this.sessionTtlMs = config?.sessionTtlMs ?? 30 * 60 * 1000;
  }

  public getSession(sessionId: string): WorkingMemory {
    this.cleanupExpiredSessions();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.updated_at = Date.now();
      return existing;
    }

    const newSession: WorkingMemory = {
      session_id: sessionId,
      active_facility: null,
      focused_room: null,
      shortlisted_rooms: [],
      stay_type: 'nghi_gio',
      checkin_datetime: null,
      duration_hours: null,
      max_budget: null,
      must_have_amenities: [],
      nice_to_have_amenities: [],
      negated_constraints: [],
      preferred_styles: [],
      recent_references: [],
      last_quote_context: null,
      conversation_lifecycle: 'DISCOVERY',
      ownership_state: 'AI_ACTIVE',
      pending_clarification: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      turn_count: 0,
    };

    this.sessions.set(sessionId, newSession);
    return newSession;
  }

  public getOrCreate(sessionId: string): WorkingMemory {
    return this.getSession(sessionId);
  }

  /**
   * Applies targeted updates from extracted entities to session working memory.
   * Only updates slots mentioned in current turn; preserves unchanged context.
   */
  public updateMemory(
    sessionId: string,
    entities: ExtractedEntities,
    turnIndex: number
  ): WorkingMemory {
    const memory = this.getSession(sessionId);
    memory.turn_count = turnIndex;
    memory.updated_at = Date.now();

    // 1. Facility update
    if (entities.facility) {
      if (memory.active_facility !== entities.facility) {
        memory.active_facility = entities.facility;
        // If facility changes, focused room is cleared unless it belongs to the new facility
        if (memory.focused_room && memory.focused_room.co_so_ma !== entities.facility) {
          memory.focused_room = null;
        }
      }
    }

    // 2. Stay Type update
    if (entities.stay_type) {
      memory.stay_type = entities.stay_type;
    }

    // 3. Check-in datetime update
    if (entities.checkin_datetime) {
      memory.checkin_datetime = entities.checkin_datetime;
    }

    // 4. Duration update
    if (entities.duration_hours !== undefined) {
      memory.duration_hours = entities.duration_hours;
    }

    // 5. Budget update
    if (entities.budget !== undefined) {
      memory.max_budget = entities.budget;
    }

    // 6. Focused room update
    if (entities.room_key) {
      memory.focused_room = entities.room_key;
      memory.recent_references.push({
        key: entities.room_key,
        mentioned_at_turn: turnIndex,
      });
      if (!memory.active_facility) {
        memory.active_facility = entities.room_key.co_so_ma;
      }
    }

    // 7. Requirements Actions: ADD_REQUIREMENT
    if (entities.must_have_amenities && entities.must_have_amenities.length > 0) {
      entities.must_have_amenities.forEach((amenity) => {
        this.addRequirement(sessionId, amenity);
      });
    }

    if (entities.nice_to_have_amenities && entities.nice_to_have_amenities.length > 0) {
      entities.nice_to_have_amenities.forEach((amenity) => {
        if (!memory.nice_to_have_amenities.includes(amenity)) {
          memory.nice_to_have_amenities.push(amenity);
        }
      });
    }

    // 8. Requirements Actions: REMOVE_REQUIREMENT (drop from must_have, do NOT negate)
    const toRemove = entities.removed_requirements ?? entities.removed_constraints;
    if (toRemove && toRemove.length > 0) {
      toRemove.forEach((removed) => {
        this.removeRequirement(sessionId, removed);
      });
    }

    // 9. Requirements Actions: NEGATE_REQUIREMENT (ban/exclude amenity)
    if (entities.negated_constraints && entities.negated_constraints.length > 0) {
      entities.negated_constraints.forEach((c) => {
        this.negateRequirement(sessionId, c);
      });
    }

    // 10. Requirements Actions: REPLACE_REQUIREMENT / CLEAR_NEGATION (un-ban amenity)
    if (entities.cleared_negations && entities.cleared_negations.length > 0) {
      entities.cleared_negations.forEach((c) => {
        this.clearNegation(sessionId, c);
      });
    }

    // 11. Preferred styles
    if (entities.style_preference && entities.style_preference.length > 0) {
      entities.style_preference.forEach((style) => {
        if (!memory.preferred_styles.includes(style)) {
          memory.preferred_styles.push(style);
        }
      });
    }

    return memory;
  }

  public updateSlots(sessionId: string, updates: Partial<WorkingMemory>): WorkingMemory {
    const memory = this.getSession(sessionId);
    Object.assign(memory, updates);
    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * ADD_REQUIREMENT: Adds amenity to must_have_amenities, removes it from negated_constraints.
   */
  public addRequirement(sessionId: string, amenity: string): WorkingMemory {
    const memory = this.getSession(sessionId);
    const norm = amenity.toLowerCase();

    // Clear from negated if present
    memory.negated_constraints = memory.negated_constraints.filter(
      (c) => !c.toLowerCase().includes(norm) && !norm.includes(c.toLowerCase())
    );

    // Add to must-haves
    if (!memory.must_have_amenities.some((a) => a.toLowerCase().includes(norm) || norm.includes(a.toLowerCase()))) {
      memory.must_have_amenities.push(amenity);
    }
    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * REMOVE_REQUIREMENT: Drops requirement from must_have_amenities.
   * Semantic Rule: Does NOT add to negated_constraints! Rooms with this amenity can still be suggested.
   */
  public removeRequirement(sessionId: string, amenity: string): WorkingMemory {
    const memory = this.getSession(sessionId);
    const norm = amenity.toLowerCase();
    memory.must_have_amenities = memory.must_have_amenities.filter(
      (a) => !a.toLowerCase().includes(norm) && !norm.includes(a.toLowerCase())
    );
    memory.nice_to_have_amenities = memory.nice_to_have_amenities.filter(
      (a) => !a.toLowerCase().includes(norm) && !norm.includes(a.toLowerCase())
    );
    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * NEGATE_REQUIREMENT: Actively excludes/bans amenity.
   * Semantic Rule: Removes from must_have, adds to negated_constraints.
   */
  public negateRequirement(sessionId: string, amenity: string): WorkingMemory {
    const memory = this.getSession(sessionId);
    const norm = amenity.toLowerCase();
    memory.must_have_amenities = memory.must_have_amenities.filter(
      (a) => !a.toLowerCase().includes(norm) && !norm.includes(a.toLowerCase())
    );
    memory.nice_to_have_amenities = memory.nice_to_have_amenities.filter(
      (a) => !a.toLowerCase().includes(norm) && !norm.includes(a.toLowerCase())
    );
    if (!memory.negated_constraints.some((c) => c.toLowerCase().includes(norm) || norm.includes(c.toLowerCase()))) {
      memory.negated_constraints.push(amenity);
    }
    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * REPLACE_REQUIREMENT / CLEAR_NEGATION: Clears a negated constraint.
   * Semantic Rule: Removes from negated_constraints, does NOT force into must_have_amenities.
   */
  public clearNegation(sessionId: string, amenity: string): WorkingMemory {
    const memory = this.getSession(sessionId);
    const norm = amenity.toLowerCase();
    memory.negated_constraints = memory.negated_constraints.filter(
      (c) => !c.toLowerCase().includes(norm) && !norm.includes(c.toLowerCase())
    );
    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * Backward-compatible alias for removeRequirement
   */
  public retractConstraint(sessionId: string, constraint: string): void {
    this.removeRequirement(sessionId, constraint);
  }

  public updateShortlist(sessionId: string, shortlist: ShortlistedRoomItem[], focusedRoom?: CompositeRoomKey | null): void {
    const memory = this.getSession(sessionId);
    memory.shortlisted_rooms = shortlist;
    if (focusedRoom !== undefined) {
      memory.focused_room = focusedRoom;
    }
  }

  /**
   * Records a topic transition in working memory for context tracking and rollback.
   */
  public recordTopicTransition(
    sessionId: string,
    newTopic: string,
    focusedRoom?: CompositeRoomKey | null,
    targetCategory?: RawRoomCategory
  ): WorkingMemory {
    const memory = this.getSession(sessionId);
    if (!memory.topic_history) {
      memory.topic_history = [];
    }

    if (memory.active_topic && memory.active_topic !== newTopic) {
      memory.previous_topic = memory.active_topic;
    }
    memory.active_topic = newTopic;

    memory.topic_history.push({
      turn: memory.turn_count,
      topic: newTopic,
      focused_room: focusedRoom ?? memory.focused_room,
      target_category: targetCategory ?? memory.target_category,
    });

    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * Selectively invalidates obsolete context slots upon topic switch or user redirection.
   */
  public invalidateContext(
    sessionId: string,
    options: {
      clearFocusedRoom?: boolean;
      clearRequirements?: boolean;
      clearShortlist?: boolean;
      clearCategory?: boolean;
    }
  ): WorkingMemory {
    const memory = this.getSession(sessionId);

    if (options.clearFocusedRoom) {
      memory.focused_room = null;
    }
    if (options.clearRequirements) {
      memory.must_have_amenities = [];
      memory.nice_to_have_amenities = [];
    }
    if (options.clearShortlist) {
      memory.shortlisted_rooms = [];
    }
    if (options.clearCategory) {
      memory.target_category = undefined;
    }

    memory.updated_at = Date.now();
    return memory;
  }

  /**
   * Resumes the previous topic and restores focused room / category from history.
   */
  public resumePreviousTopic(sessionId: string): { restored: boolean; previousTopic?: string } {
    const memory = this.getSession(sessionId);
    if (!memory.topic_history || memory.topic_history.length < 2) {
      return { restored: false };
    }

    // Step back to earlier entry
    const prevEntry = memory.topic_history[memory.topic_history.length - 2];
    memory.active_topic = prevEntry.topic;
    if (prevEntry.focused_room !== undefined) {
      memory.focused_room = prevEntry.focused_room;
    }
    if (prevEntry.target_category !== undefined) {
      memory.target_category = prevEntry.target_category;
    }

    memory.updated_at = Date.now();
    return { restored: true, previousTopic: prevEntry.topic };
  }

  public resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updated_at > this.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
