import { describe, expect, it } from 'vitest';
import { OPTIONS_PER_ROUND, pickRound, SKETCH_MODELS, findModel } from './supportedModels';

describe('SKETCH_MODELS', () => {
  it('has unique ids and real model URLs', () => {
    const ids = new Set(SKETCH_MODELS.map((model) => model.id));
    expect(ids.size).toBe(SKETCH_MODELS.length);
    for (const model of SKETCH_MODELS) {
      expect(model.modelUrl).toBe(
        `https://storage.googleapis.com/quickdraw-models/sketchRNN/models/${model.id}.gen.json`,
      );
      expect(model.name.length).toBeGreaterThan(0);
      expect(model.emoji.length).toBeGreaterThan(0);
    }
  });

  it('gives every group enough members to fill a round with same-domain choices', () => {
    const sizes = new Map<string, number>();
    for (const model of SKETCH_MODELS) {
      sizes.set(model.group, (sizes.get(model.group) ?? 0) + 1);
    }
    for (const [group, size] of sizes) {
      expect(size, group).toBeGreaterThanOrEqual(OPTIONS_PER_ROUND);
    }
  });
});

describe('pickRound', () => {
  it('always offers four distinct options containing the answer', () => {
    for (let i = 0; i < 200; i += 1) {
      const round = pickRound();
      expect(round.options).toHaveLength(OPTIONS_PER_ROUND);
      expect(new Set(round.options.map((option) => option.id)).size).toBe(OPTIONS_PER_ROUND);
      expect(round.options).toContain(round.answer);
    }
  });

  it('keeps the distractors in the answer’s own group', () => {
    for (let i = 0; i < 200; i += 1) {
      const round = pickRound();
      for (const option of round.options) {
        expect(option.group, `${option.id} vs ${round.answer.id}`).toBe(round.answer.group);
      }
    }
  });

  it('avoids repeating the category just played', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(pickRound(['cat']).answer.id).not.toBe('cat');
    }
  });

  it('falls back to the full list rather than failing when everything is avoided', () => {
    const round = pickRound(SKETCH_MODELS.map((model) => model.id));
    expect(round.options).toHaveLength(OPTIONS_PER_ROUND);
  });

  it('does not put the answer in a fixed slot', () => {
    const positions = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      const round = pickRound();
      positions.add(round.options.indexOf(round.answer));
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('findModel', () => {
  it('finds a shipped category and nothing else', () => {
    expect(findModel('cat')?.name).toBe('Cat');
    expect(findModel('toothpaste')).toBeUndefined();
  });
});
