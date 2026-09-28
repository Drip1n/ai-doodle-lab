import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CLASS_IDS,
  DEFAULT_CLASSES,
  type ChallengeStats,
  type ClassDef,
  type ClassId,
  type Example,
  type ExampleSource,
  type ModelStatus,
  type Prediction,
} from '../types';
import * as ml from '../ml/classifier';
import { toThumbnail } from '../ml/imageProcessing';
import * as db from '../storage/db';

const MIN_EXAMPLES_PER_CLASS = 2;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface TeachResult {
  example: Example;
}

export function useAiLab() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: 'loading',
    message: 'Getting your AI ready…',
  });
  const [examples, setExamples] = useState<Example[]>([]);
  const [names, setNames] = useState<Record<ClassId, string>>({
    cat: DEFAULT_CLASSES.cat.name,
    house: DEFAULT_CLASSES.house.name,
    tree: DEFAULT_CLASSES.tree.name,
  });
  const [stats, setStats] = useState<ChallengeStats>({ attempts: 0, correct: 0 });

  const boot = useCallback(async () => {
    setModelStatus({ state: 'loading', message: 'Getting your AI ready…' });
    try {
      await ml.loadModel((message) => setModelStatus({ state: 'loading', message }));

      const [stored, storedNames, storedStats] = await Promise.all([
        db.loadExamples(),
        db.loadClassNames(),
        db.loadStats(),
      ]);

      if (stored.length) {
        // Replay the saved embeddings so the AI remembers last session.
        ml.rebuildFrom(stored);
        setExamples(stored);
      }
      if (storedNames) setNames((current) => ({ ...current, ...storedNames }));
      if (storedStats) setStats(storedStats);

      setModelStatus({ state: 'ready' });
    } catch (error) {
      setModelStatus({
        state: 'error',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'The AI vision model could not be downloaded.',
      });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const classes = useMemo<ClassDef[]>(
    () => CLASS_IDS.map((id) => ({ ...DEFAULT_CLASSES[id], name: names[id] })),
    [names],
  );

  const counts = useMemo(() => {
    const result = { cat: 0, house: 0, tree: 0 } as Record<ClassId, number>;
    for (const example of examples) result[example.classId] += 1;
    return result;
  }, [examples]);

  const total = examples.length;

  const readyForChallenge = CLASS_IDS.every((id) => counts[id] >= MIN_EXAMPLES_PER_CLASS);

  const teach = useCallback(
    async (
      source: HTMLCanvasElement | HTMLImageElement,
      classId: ClassId,
      sourceKind: ExampleSource,
      knownEmbedding?: Float32Array,
    ): Promise<TeachResult> => {
      const embedding = knownEmbedding ?? (await ml.embedToArray(source));
      ml.addExample(embedding, classId);
      const example: Example = {
        id: newId(),
        classId,
        thumbnail: toThumbnail(source),
        embedding,
        createdAt: Date.now(),
        source: sourceKind,
      };
      setExamples((current) => [...current, example]);
      void db.saveExample(example);
      return { example };
    },
    [],
  );

  const classify = useCallback(
    async (
      source: HTMLCanvasElement | HTMLImageElement,
    ): Promise<{ prediction: Prediction; embedding: Float32Array }> => {
      const embedding = await ml.embedToArray(source);
      const prediction = await ml.predict(embedding);
      return { prediction, embedding };
    },
    [],
  );

  const recordChallenge = useCallback((wasCorrect: boolean) => {
    setStats((current) => {
      const next = {
        attempts: current.attempts + 1,
        correct: current.correct + (wasCorrect ? 1 : 0),
      };
      void db.saveStats(next);
      return next;
    });
  }, []);

  const renameClass = useCallback((id: ClassId, name: string) => {
    setNames((current) => {
      const next = { ...current, [id]: name.trim() || DEFAULT_CLASSES[id].name };
      void db.saveClassNames(next);
      return next;
    });
  }, []);

  const reset = useCallback(async () => {
    ml.resetClassifier();
    setExamples([]);
    setStats({ attempts: 0, correct: 0 });
    setNames({
      cat: DEFAULT_CLASSES.cat.name,
      house: DEFAULT_CLASSES.house.name,
      tree: DEFAULT_CLASSES.tree.name,
    });
    await Promise.all([db.clearExamples(), db.clearMeta()]);
  }, []);

  return {
    modelStatus,
    retryLoad: boot,
    classes,
    examples,
    counts,
    total,
    stats,
    readyForChallenge,
    minExamplesPerClass: MIN_EXAMPLES_PER_CLASS,
    teach,
    classify,
    recordChallenge,
    renameClass,
    reset,
  };
}

export type AiLab = ReturnType<typeof useAiLab>;
