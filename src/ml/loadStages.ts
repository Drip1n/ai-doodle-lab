/**
 * The startup sequence, as honest stages.
 *
 * MobileNet is fetched through `@tensorflow-models/mobilenet`, which gives us
 * no byte-level download progress, so inventing a percentage would be a lie.
 * Instead the bar reports which setup step is finished: entering a stage means
 * everything before it is genuinely done. The UI says so out loud ("Step 2 of
 * 4") rather than implying a download percentage.
 */

export type LoadStageId = 'engine' | 'vision' | 'warmup' | 'workshop';

export interface LoadStage {
  id: LoadStageId;
  label: string;
  /** Percentage already completed when this stage begins. */
  start: number;
  /** Percentage completed once this stage finishes. */
  end: number;
}

export const LOAD_STAGES: LoadStage[] = [
  { id: 'engine', label: 'Starting the AI engine…', start: 0, end: 15 },
  { id: 'vision', label: 'Loading AI vision…', start: 15, end: 80 },
  { id: 'warmup', label: 'Warming up…', start: 80, end: 95 },
  { id: 'workshop', label: 'Preparing your workshop…', start: 95, end: 100 },
];

export interface LoadProgress {
  stage: LoadStageId;
  label: string;
  /** 1-based, for "Step 2 of 4". */
  step: number;
  totalSteps: number;
  /** Stage-derived, never a download percentage. */
  percent: number;
}

export function progressFor(stage: LoadStageId): LoadProgress {
  const index = LOAD_STAGES.findIndex((entry) => entry.id === stage);
  const found = index >= 0 ? index : 0;
  const entry = LOAD_STAGES[found];
  return {
    stage: entry.id,
    label: entry.label,
    step: found + 1,
    totalSteps: LOAD_STAGES.length,
    percent: entry.start,
  };
}

export const FIRST_PROGRESS = progressFor(LOAD_STAGES[0].id);
