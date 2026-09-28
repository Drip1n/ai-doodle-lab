import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COLOR_PALETTE,
  MAX_CLASSES,
  MIN_CLASSES,
  STARTER_POOL,
  type ChallengeStats,
  type ClassId,
  type Example,
  type ExampleSource,
  type LearningClass,
  type ModelStatus,
  type Prediction,
} from '../types';
import * as ml from '../ml/classifier';
import { toThumbnail } from '../ml/imageProcessing';
import * as db from '../storage/db';

const MIN_EXAMPLES_PER_CLASS = 2;
const EMPTY_STATS: ChallengeStats = { attempts: 0, correct: 0 };

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Three random, unique starter categories -- re-rolled only on first run or reset. */
function pickStarterClasses(): LearningClass[] {
  return shuffle(STARTER_POOL)
    .slice(0, 3)
    .map((pick, index) => ({
      id: pick.id,
      name: pick.name,
      emoji: pick.emoji,
      accent: COLOR_PALETTE[index % COLOR_PALETTE.length].accent,
      accentSoft: COLOR_PALETTE[index % COLOR_PALETTE.length].accentSoft,
    }));
}

function nextColor(existing: LearningClass[]): { accent: string; accentSoft: string } {
  const used = new Set(existing.map((def) => def.accent));
  return COLOR_PALETTE.find((color) => !used.has(color.accent)) ?? COLOR_PALETTE[existing.length % COLOR_PALETTE.length];
}

export interface TeachResult {
  example: Example;
}

export function useAiLab() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: 'loading',
    message: 'Getting your AI ready…',
  });
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [stats, setStats] = useState<ChallengeStats>(EMPTY_STATS);
  const [memoryStats, setMemoryStats] = useState<ChallengeStats>(EMPTY_STATS);

  const boot = useCallback(async () => {
    setModelStatus({ state: 'loading', message: 'Getting your AI ready…' });
    try {
      await ml.loadModel((message) => setModelStatus({ state: 'loading', message }));

      const [storedExamples, storedClasses, storedStats, storedMemoryStats] = await Promise.all([
        db.loadExamples(),
        db.loadClasses(),
        db.loadStats(),
        db.loadMemoryStats(),
      ]);

      let activeClasses = storedClasses;
      if (!activeClasses || activeClasses.length === 0) {
        activeClasses = pickStarterClasses();
        void db.saveClasses(activeClasses);
      }
      setClasses(activeClasses);

      if (storedExamples.length) {
        // Replay the saved embeddings so the AI remembers last session.
        ml.rebuildFrom(storedExamples);
        setExamples(storedExamples);
      }
      if (storedStats) setStats(storedStats);
      if (storedMemoryStats) setMemoryStats(storedMemoryStats);

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

  const counts = useMemo(() => {
    const result: Record<ClassId, number> = {};
    for (const def of classes) result[def.id] = 0;
    for (const example of examples) {
      result[example.classId] = (result[example.classId] ?? 0) + 1;
    }
    return result;
  }, [classes, examples]);

  const total = examples.length;

  const trainedClasses = useMemo(
    () => classes.filter((def) => (counts[def.id] ?? 0) >= MIN_EXAMPLES_PER_CLASS),
    [classes, counts],
  );

  // Two well-trained categories are enough for a meaningful guessing game.
  const readyForChallenge = trainedClasses.length >= 2;
  const canAddClass = classes.length < MAX_CLASSES;
  const canDeleteClass = classes.length > MIN_CLASSES;

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
      const prediction = await ml.predict(
        embedding,
        classes.map((def) => def.id),
      );
      return { prediction, embedding };
    },
    [classes],
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

  const recordMemoryChallenge = useCallback((wasCorrect: boolean) => {
    setMemoryStats((current) => {
      const next = {
        attempts: current.attempts + 1,
        correct: current.correct + (wasCorrect ? 1 : 0),
      };
      void db.saveMemoryStats(next);
      return next;
    });
  }, []);

  const renameClass = useCallback((id: ClassId, name: string) => {
    setClasses((current) => {
      const next = current.map((def) => (def.id === id ? { ...def, name: name.trim() || def.name } : def));
      void db.saveClasses(next);
      return next;
    });
  }, []);

  const changeEmoji = useCallback((id: ClassId, emoji: string) => {
    setClasses((current) => {
      const next = current.map((def) => (def.id === id ? { ...def, emoji } : def));
      void db.saveClasses(next);
      return next;
    });
  }, []);

  const addClass = useCallback(
    (name: string, emoji: string): ClassId | null => {
      if (classes.length >= MAX_CLASSES) return null;
      const color = nextColor(classes);
      const created: LearningClass = {
        id: newId(),
        name: name.trim() || 'New',
        emoji: emoji || '❓',
        accent: color.accent,
        accentSoft: color.accentSoft,
      };
      setClasses((current) => {
        const next = [...current, created];
        void db.saveClasses(next);
        return next;
      });
      return created.id;
    },
    [classes],
  );

  const deleteClass = useCallback(async (id: ClassId) => {
    ml.removeClass(id);
    setClasses((current) => {
      const next = current.filter((def) => def.id !== id);
      void db.saveClasses(next);
      return next;
    });
    setExamples((current) => current.filter((example) => example.classId !== id));
    await db.deleteExamplesForClass(id);
  }, []);

  const pickRandomExample = useCallback((): Example | null => {
    if (examples.length === 0) return null;
    return examples[Math.floor(Math.random() * examples.length)];
  }, [examples]);

  const reset = useCallback(async () => {
    ml.resetClassifier();
    const starter = pickStarterClasses();
    setClasses(starter);
    setExamples([]);
    setStats(EMPTY_STATS);
    setMemoryStats(EMPTY_STATS);
    await Promise.all([db.clearExamples(), db.clearMeta()]);
    await db.saveClasses(starter);
  }, []);

  return {
    modelStatus,
    retryLoad: boot,
    classes,
    examples,
    counts,
    total,
    stats,
    memoryStats,
    trainedClasses,
    readyForChallenge,
    minExamplesPerClass: MIN_EXAMPLES_PER_CLASS,
    maxClasses: MAX_CLASSES,
    canAddClass,
    canDeleteClass,
    teach,
    classify,
    recordChallenge,
    recordMemoryChallenge,
    renameClass,
    changeEmoji,
    addClass,
    deleteClass,
    pickRandomExample,
    reset,
  };
}

export type AiLab = ReturnType<typeof useAiLab>;
