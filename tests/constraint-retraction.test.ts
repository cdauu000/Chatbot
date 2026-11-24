import { describe, it, expect } from 'vitest';
import { MemoryManager } from '../src/conversation/memory-manager.js';
import { NLUEngine } from '../src/conversation/nlu-engine.js';

describe('Milestone 3 - A1. Constraint Retraction Semantics', () => {
  const nlu = new NLUEngine();

  it('Action 1: REMOVE_REQUIREMENT ("Thôi không cần bồn tắm nữa")', () => {
    const mm = new MemoryManager();
    const sId = 'test-remove-req';

    // Step 1: Add bathtub
    mm.updateMemory(sId, { must_have_amenities: ['bồn tắm'] }, 1);
    expect(mm.getSession(sId).must_have_amenities).toContain('bồn tắm');
    expect(mm.getSession(sId).negated_constraints).not.toContain('bồn tắm');

    // Step 2: NLU parse "Thôi không cần bồn tắm nữa"
    const parsed = nlu.parse('Thôi không cần bồn tắm nữa', mm.getSession(sId));
    expect(parsed.intent).toBe('REMOVE_REQUIREMENT');
    expect(parsed.entities.removed_requirements).toContain('bồn tắm');
    expect(parsed.entities.negated_constraints).toBeUndefined();

    // Step 3: Apply to memory
    mm.updateMemory(sId, parsed.entities, 2);
    const updated = mm.getSession(sId);

    // Assert: Bathtub is removed from must_have, and NOT added to negated_constraints!
    expect(updated.must_have_amenities).not.toContain('bồn tắm');
    expect(updated.negated_constraints).not.toContain('bồn tắm');
  });

  it('Action 2: NEGATE_REQUIREMENT ("Không lấy phòng có bồn tắm")', () => {
    const mm = new MemoryManager();
    const sId = 'test-negate-req';

    // Step 1: Initially user had bathtub
    mm.updateMemory(sId, { must_have_amenities: ['bồn tắm'] }, 1);

    // Step 2: NLU parse "Không lấy phòng có bồn tắm"
    const parsed = nlu.parse('Không lấy phòng có bồn tắm', mm.getSession(sId));
    expect(parsed.intent).toBe('NEGATE_REQUIREMENT');
    expect(parsed.entities.negated_constraints).toContain('bồn tắm');

    // Step 3: Apply to memory
    mm.updateMemory(sId, parsed.entities, 2);
    const updated = mm.getSession(sId);

    // Assert: Bathtub is removed from must_have, and ADDED to negated_constraints!
    expect(updated.must_have_amenities).not.toContain('bồn tắm');
    expect(updated.negated_constraints).toContain('bồn tắm');
  });

  it('Action 3: REPLACE_REQUIREMENT / CLEAR_NEGATION ("Thôi có bồn tắm cũng được")', () => {
    const mm = new MemoryManager();
    const sId = 'test-clear-neg';

    // Step 1: User previously negated bathtub
    mm.negateRequirement(sId, 'bồn tắm');
    expect(mm.getSession(sId).negated_constraints).toContain('bồn tắm');
    expect(mm.getSession(sId).must_have_amenities).not.toContain('bồn tắm');

    // Step 2: NLU parse "Thôi có bồn tắm cũng được"
    const parsed = nlu.parse('Thôi có bồn tắm cũng được', mm.getSession(sId));
    expect(parsed.intent).toBe('CLEAR_NEGATION');
    expect(parsed.entities.cleared_negations).toContain('bồn tắm');

    // Step 3: Apply to memory
    mm.updateMemory(sId, parsed.entities, 2);
    const updated = mm.getSession(sId);

    // Assert: Bathtub is removed from negated_constraints, but NOT forced into must_have!
    expect(updated.negated_constraints).not.toContain('bồn tắm');
    expect(updated.must_have_amenities).not.toContain('bồn tắm');
  });

  it('Action 4: ADD_REQUIREMENT clears previous negation', () => {
    const mm = new MemoryManager();
    const sId = 'test-add-clears-neg';

    // Step 1: Negate bathtub
    mm.negateRequirement(sId, 'bồn tắm');
    expect(mm.getSession(sId).negated_constraints).toContain('bồn tắm');

    // Step 2: User explicitly adds bathtub back ("Cho anh phòng có bồn tắm")
    const parsed = nlu.parse('Cho anh phòng có bồn tắm', mm.getSession(sId));
    expect(parsed.entities.must_have_amenities).toContain('bồn tắm');

    mm.updateMemory(sId, parsed.entities, 2);
    const updated = mm.getSession(sId);

    expect(updated.must_have_amenities).toContain('bồn tắm');
    expect(updated.negated_constraints).not.toContain('bồn tắm');
  });
});
