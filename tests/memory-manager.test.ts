import { describe, it, expect } from 'vitest';
import { MemoryManager } from '../src/conversation/memory-manager.js';

describe('MemoryManager - Session Management & Slot Updates', () => {
  it('creates and isolates distinct sessions (Scenario J)', () => {
    const mm = new MemoryManager();
    const sessionA = mm.getSession('user-session-A');
    const sessionB = mm.getSession('user-session-B');

    mm.updateSlots('user-session-A', {
      active_facility: 'j-village',
      max_budget: 500000,
    });

    mm.updateSlots('user-session-B', {
      active_facility: 'jacayl-ha-dong',
      max_budget: 350000,
    });

    const refreshedA = mm.getSession('user-session-A');
    const refreshedB = mm.getSession('user-session-B');

    expect(refreshedA.active_facility).toBe('j-village');
    expect(refreshedA.max_budget).toBe(500000);

    expect(refreshedB.active_facility).toBe('jacayl-ha-dong');
    expect(refreshedB.max_budget).toBe(350000);
  });

  it('performs targeted slot updates without wiping unaffected context', () => {
    const mm = new MemoryManager();
    const sId = 'user-test-targeted';

    // Turn 1: specify facility and must-have amenities
    mm.updateSlots(sId, {
      active_facility: 'jacayl-tran-khat-chan',
      must_have_amenities: ['bồn tắm', 'máy chiếu'],
    });

    // Turn 2: specify duration and budget
    mm.updateSlots(sId, {
      duration_hours: 3,
      max_budget: 450000,
    });

    const memory = mm.getSession(sId);
    expect(memory.active_facility).toBe('jacayl-tran-khat-chan');
    expect(memory.must_have_amenities).toEqual(['bồn tắm', 'máy chiếu']);
    expect(memory.duration_hours).toBe(3);
    expect(memory.max_budget).toBe(450000);
  });

  it('preserves slots during facility switch (Scenario E)', () => {
    const mm = new MemoryManager();
    const sId = 'user-test-facility-switch';

    mm.updateSlots(sId, {
      active_facility: 'jacayl-tran-khat-chan',
      checkin_datetime: '2026-11-28T14:00:00+07:00',
      duration_hours: 3,
      must_have_amenities: ['bồn tắm'],
    });

    // Switch facility to J Village
    mm.updateSlots(sId, {
      active_facility: 'j-village',
    });

    const memory = mm.getSession(sId);
    expect(memory.active_facility).toBe('j-village');
    expect(memory.checkin_datetime).toBe('2026-11-28T14:00:00+07:00');
    expect(memory.duration_hours).toBe(3);
    expect(memory.must_have_amenities).toContain('bồn tắm');
  });

  it('retracts constraints properly without adding to negated constraints (M3 A1 Semantic Fix)', () => {
    const mm = new MemoryManager();
    const sId = 'user-test-retraction';

    mm.updateSlots(sId, {
      must_have_amenities: ['bồn tắm', 'ghế tình yêu'],
    });

    expect(mm.getSession(sId).must_have_amenities).toContain('ghế tình yêu');

    // Retract 'ghế tình yêu' via removeRequirement
    mm.removeRequirement(sId, 'ghế tình yêu');

    const updated = mm.getSession(sId);
    expect(updated.must_have_amenities).toContain('bồn tắm');
    expect(updated.must_have_amenities).not.toContain('ghế tình yêu');
    // M3 A1 Fix: REMOVE_REQUIREMENT drops requirement, does NOT actively negate/ban it
    expect(updated.negated_constraints).not.toContain('ghế tình yêu');

    // When explicitly negating via negateRequirement ("Không lấy phòng có ghế tình yêu"):
    mm.negateRequirement(sId, 'ghế tình yêu');
    expect(mm.getSession(sId).negated_constraints).toContain('ghế tình yêu');
  });

  it('cleans up expired sessions past TTL', () => {
    const shortTtlMs = 10;
    const mm = new MemoryManager({ sessionTtlMs: shortTtlMs });
    const sId = 'expiring-session';

    mm.updateSlots(sId, { active_facility: 'j-village' });
    expect(mm.getSession(sId).active_facility).toBe('j-village');

    // Artificially age the session
    const rawSession = (mm as any).sessions.get(sId);
    rawSession.updated_at = Date.now() - 20;

    // Trigger cleanup
    (mm as any).cleanupExpiredSessions();
    expect((mm as any).sessions.has(sId)).toBe(false);
  });
});
