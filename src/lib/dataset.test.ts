import { describe, expect, it } from 'vitest';
import {
  countExamples,
  createClass,
  pickStarterClasses,
  recordStat,
  removeClassFrom,
  renameClassIn,
  resolveSelection,
  setEmojiIn,
  splitOrphanExamples,
} from './dataset';
import { MAX_CLASSES, type Example, type LearningClass } from '../types';

const def = (id: string, over: Partial<LearningClass> = {}): LearningClass => ({
  id,
  name: id,
  emoji: '🐱',
  accent: '#000',
  accentSoft: '#fff',
  ...over,
});

const example = (id: string, classId: string): Example => ({
  id,
  classId,
  thumbnail: 'data:,',
  embedding: new Float32Array([1, 2, 3]),
  createdAt: 0,
  source: 'drawing',
});

describe('starter categories', () => {
  it('picks three unique categories', () => {
    const picked = pickStarterClasses();
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((c) => c.id)).size).toBe(3);
  });

  it('gives each starter its own colour', () => {
    const picked = pickStarterClasses();
    expect(new Set(picked.map((c) => c.accent)).size).toBe(3);
  });

  it('re-rolls a different set given different randomness', () => {
    const a = pickStarterClasses(() => 0);
    const b = pickStarterClasses(() => 0.99);
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });
});

describe('creating categories', () => {
  it('assigns a colour not already in use', () => {
    const existing = [def('a', { accent: '#F2704B' })];
    const created = createClass(existing, 'Robot', '🚀');
    expect(created?.accent).not.toBe('#F2704B');
  });

  it('refuses to exceed the maximum', () => {
    const full = Array.from({ length: MAX_CLASSES }, (_, i) => def(`c${i}`));
    expect(createClass(full, 'One more', '🚀')).toBeNull();
  });

  it('refuses a blank name', () => {
    expect(createClass([], '   ', '🚀')).toBeNull();
  });

  it('supports a category with no icon', () => {
    expect(createClass([], 'Car', undefined)?.emoji).toBeUndefined();
    expect(createClass([], 'Car', '')?.emoji).toBeUndefined();
    expect(createClass([], 'Car', '  ')?.emoji).toBeUndefined();
  });
});

describe('renaming and re-iconing', () => {
  const classes = [def('cat', { name: 'Cat' }), def('car', { name: 'Car' })];

  it('keeps the id stable so examples stay attached', () => {
    const renamed = renameClassIn(classes, 'car', 'Vehicle');
    expect(renamed[1].id).toBe('car');
    expect(renamed[1].name).toBe('Vehicle');
  });

  it('ignores a blank rename', () => {
    expect(renameClassIn(classes, 'car', '   ')[1].name).toBe('Car');
  });

  it('changes the icon without touching the id', () => {
    const changed = setEmojiIn(classes, 'car', '🚀');
    expect(changed[1]).toMatchObject({ id: 'car', emoji: '🚀' });
  });

  it('clears the icon when none is chosen', () => {
    expect(setEmojiIn(classes, 'car', undefined)[1].emoji).toBeUndefined();
    expect(setEmojiIn(classes, 'car', '')[1].emoji).toBeUndefined();
  });

  it('leaves other categories alone', () => {
    expect(renameClassIn(classes, 'car', 'Vehicle')[0]).toEqual(classes[0]);
  });
});

describe('deleting a category', () => {
  const classes = [def('cat'), def('car'), def('tree')];
  const examples = [
    example('e1', 'cat'),
    example('e2', 'car'),
    example('e3', 'cat'),
    example('e4', 'tree'),
  ];

  it('removes the category and every example under it', () => {
    const result = removeClassFrom(classes, examples, 'cat');
    expect(result.classes.map((c) => c.id)).toEqual(['car', 'tree']);
    expect(result.examples.map((e) => e.id)).toEqual(['e2', 'e4']);
  });

  it('reports which stored examples must be deleted', () => {
    expect(removeClassFrom(classes, examples, 'cat').removedExampleIds).toEqual(['e1', 'e3']);
  });

  it('works for a category that has no examples yet', () => {
    const result = removeClassFrom(classes, [example('e2', 'car')], 'tree');
    expect(result.classes.map((c) => c.id)).toEqual(['cat', 'car']);
    expect(result.examples).toHaveLength(1);
    expect(result.removedExampleIds).toEqual([]);
  });

  it('leaves the remaining dataset internally consistent', () => {
    const result = removeClassFrom(classes, examples, 'cat');
    const known = new Set(result.classes.map((c) => c.id));
    expect(result.examples.every((e) => known.has(e.classId))).toBe(true);
  });
});

describe('orphaned examples', () => {
  it('separates examples whose category is gone', () => {
    const { kept, orphans } = splitOrphanExamples(
      [def('cat')],
      [example('e1', 'cat'), example('e2', 'deleted-id')],
    );
    expect(kept.map((e) => e.id)).toEqual(['e1']);
    expect(orphans.map((e) => e.id)).toEqual(['e2']);
  });

  it('keeps everything when all categories exist', () => {
    const examples = [example('e1', 'cat')];
    expect(splitOrphanExamples([def('cat')], examples).orphans).toEqual([]);
  });
});

describe('counts stay in sync with categories', () => {
  it('counts per category and zeroes empty ones', () => {
    const counts = countExamples(
      [def('cat'), def('car')],
      [example('e1', 'cat'), example('e2', 'cat')],
    );
    expect(counts).toEqual({ cat: 2, car: 0 });
  });

  it('never counts an example from a deleted category', () => {
    const counts = countExamples([def('cat')], [example('e1', 'cat'), example('e2', 'gone')]);
    expect(counts).toEqual({ cat: 1 });
  });
});

describe('challenge statistics', () => {
  it('counts a correct answer towards both totals', () => {
    expect(recordStat({ attempts: 2, correct: 1 }, true)).toEqual({ attempts: 3, correct: 2 });
  });

  it('counts a wrong answer as an attempt only', () => {
    expect(recordStat({ attempts: 2, correct: 1 }, false)).toEqual({ attempts: 3, correct: 1 });
  });

  it('starts from zero after a reset', () => {
    expect(recordStat({ attempts: 0, correct: 0 }, false)).toEqual({ attempts: 1, correct: 0 });
  });
});

describe('selection recovery', () => {
  const classes = [def('cat'), def('car')];

  it('keeps a still-valid selection', () => {
    expect(resolveSelection(classes, 'car')).toBe('car');
  });

  it('falls back to the first category when the selected one is deleted', () => {
    expect(resolveSelection(classes, 'deleted-id')).toBe('cat');
  });

  it('selects something when nothing was selected', () => {
    expect(resolveSelection(classes, null)).toBe('cat');
  });

  it('reports nothing selectable when there are no categories', () => {
    expect(resolveSelection([], 'cat')).toBeNull();
  });
});
