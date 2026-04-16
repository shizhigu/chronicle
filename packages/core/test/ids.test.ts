import { describe, expect, it } from 'bun:test';
import { IdPrefix, agentId, generateId, worldId } from '../src/ids.js';

describe('ids', () => {
  it('generateId uses given prefix', () => {
    const id = generateId('xyz');
    expect(id).toMatch(/^xyz_[a-z0-9]{6}$/);
  });

  it('worldId uses "chr" prefix', () => {
    expect(worldId()).toMatch(/^chr_[a-z0-9]{6}$/);
  });

  it('agentId uses "agt" prefix', () => {
    expect(agentId()).toMatch(/^agt_[a-z0-9]{6}$/);
  });

  it('prefixes are distinct', () => {
    expect(new Set(Object.values(IdPrefix)).size).toBe(Object.values(IdPrefix).length);
  });

  it('ids from batch are unique', () => {
    const batch = new Set(Array.from({ length: 1000 }, () => worldId()));
    expect(batch.size).toBe(1000);
  });
});
