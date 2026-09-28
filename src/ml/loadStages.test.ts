import { describe, expect, it } from 'vitest';
import { FIRST_PROGRESS, LOAD_STAGES, progressFor } from './loadStages';

describe('LOAD_STAGES', () => {
  it('covers 0 to 100 without a gap or an overlap', () => {
    expect(LOAD_STAGES[0].start).toBe(0);
    expect(LOAD_STAGES[LOAD_STAGES.length - 1].end).toBe(100);
    for (let i = 0; i < LOAD_STAGES.length; i += 1) {
      const stage = LOAD_STAGES[i];
      expect(stage.end, stage.id).toBeGreaterThan(stage.start);
      if (i > 0) expect(stage.start, stage.id).toBe(LOAD_STAGES[i - 1].end);
    }
  });

  it('gives every stage something to say', () => {
    for (const stage of LOAD_STAGES) {
      expect(stage.label.length, stage.id).toBeGreaterThan(0);
    }
  });
});

describe('progressFor', () => {
  it('reports the work already finished, never a guess at the current step', () => {
    for (const stage of LOAD_STAGES) {
      expect(progressFor(stage.id).percent).toBe(stage.start);
    }
  });

  it('numbers the steps from one', () => {
    expect(progressFor('engine').step).toBe(1);
    expect(progressFor('workshop').step).toBe(LOAD_STAGES.length);
    for (const stage of LOAD_STAGES) {
      expect(progressFor(stage.id).totalSteps).toBe(LOAD_STAGES.length);
    }
  });

  it('never goes backwards as the stages advance', () => {
    const percents = LOAD_STAGES.map((stage) => progressFor(stage.id).percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  it('starts at the first stage', () => {
    expect(FIRST_PROGRESS.stage).toBe(LOAD_STAGES[0].id);
    expect(FIRST_PROGRESS.percent).toBe(0);
  });
});
