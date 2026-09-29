import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_CLASSES,
  MIN_CLASSES,
  type AiDrawStats,
  type ChallengeStats,
  type ClassId,
  type Example,
  type ExampleSource,
  type LearningClass,
  type ModelStatus,
  type Prediction,
} from '../types';
import {
  countExamples,
  createClass,
  newId,
  pickStarterClasses,
  recordAiDrawRound,
  recordStat,
  removeClassFrom,
  renameClassIn,
  setEmojiIn,
  splitOrphanExamples,
} from '../lib/dataset';
import * as ml from '../ml/classifier';
import { FIRST_PROGRESS, progressFor } from '../ml/loadStages';
import { toThumbnail } from '../ml/imageProcessing';
import * as db from '../storage/db';

const MIN_EXAMPLES_PER_CLASS = 2;
const EMPTY_STATS: ChallengeStats = { attempts: 0, correct: 0 };
const EMPTY_AI_DRAW_STATS: AiDrawStats = { rounds: 0, correct: 0, revealPercentSum: 0 };

export interface TeachResult {
  example: Example;
}

export function useAiLab() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    state: 'loading',
    progress: FIRST_PROGRESS,
  });
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [stats, setStats] = useState<ChallengeStats>(EMPTY_STATS);
  const [memoryStats, setMemoryStats] = useState<ChallengeStats>(EMPTY_STATS);
  const [aiDrawStats, setAiDrawStats] = useState<AiDrawStats>(EMPTY_AI_DRAW_STATS);
  const [storageAvailable, setStorageAvailable] = useState(true);

  /**
   * One boot at a time. Two concurrent boots each find no saved categories
   * and each pick their own random starter set, so the second overwrites the
   * first and the Teach stage can end up pointing at a category from the set
   * that lost. React's StrictMode does exactly this in development, and so
   * does a child tapping "Try again" twice on the loader.
   */
  const bootRef = useRef<Promise<void> | null>(null);

  const bootOnce = useCallback(async () => {
    setModelStatus({ state: 'loading', progress: FIRST_PROGRESS });
    try {
      await ml.loadModel((stage) =>
        setModelStatus({ state: 'loading', progress: progressFor(stage) }),
      );
      setModelStatus({ state: 'loading', progress: progressFor('workshop') });

      const [storedExamples, storedClasses, storedStats, storedMemoryStats, storedAiDrawStats] =
        await Promise.all([
          db.loadExamples(),
          db.loadClasses(),
          db.loadStats(),
          db.loadMemoryStats(),
          db.loadAiDrawStats(),
        ]);

      let activeClasses = storedClasses;
      if (!activeClasses || activeClasses.length === 0) {
        activeClasses = pickStarterClasses();
        void db.saveClasses(activeClasses);
      }
      setClasses(activeClasses);

      // Examples pointing at a category that no longer exists would hand the
      // classifier a label the UI cannot render, so drop them for good.
      const { kept, orphans } = splitOrphanExamples(activeClasses, storedExamples);
      for (const orphan of orphans) void db.deleteExample(orphan.id);

      // Replay the saved embeddings so the AI remembers last session.
      ml.rebuildFrom(kept);
      setExamples(kept);

      if (storedStats) setStats(storedStats);
      if (storedMemoryStats) setMemoryStats(storedMemoryStats);
      if (storedAiDrawStats) setAiDrawStats(storedAiDrawStats);

      // A browser with IndexedDB blocked still runs the whole workshop, it
      // just forgets everything when the tab closes -- worth saying quietly.
      setStorageAvailable(await db.isAvailable());

      setModelStatus({ state: 'ready' });
    } catch (error) {
      // The child gets one friendly sentence; the details stay in the console
      // for whoever is running the workshop.
      console.error('AI Doodle Lab: model loading failed', error);
      setModelStatus({ state: 'error' });
    }
  }, []);

  const boot = useCallback(async () => {
    if (bootRef.current) return bootRef.current;
    const run = bootOnce().finally(() => {
      bootRef.current = null;
    });
    bootRef.current = run;
    return run;
  }, [bootOnce]);

  // Downloading the model is exactly the "synchronise with an external
  // system" case an effect is for; the status updates it reports back are
  // the point of it, not an accident. (oxlint flags the pattern generically.)
  useEffect(() => {
    void boot();
  }, [boot]);

  const counts = useMemo(() => countExamples(classes, examples), [classes, examples]);

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
      const next = recordStat(current, wasCorrect);
      void db.saveStats(next);
      return next;
    });
  }, []);

  const recordMemoryChallenge = useCallback((wasCorrect: boolean) => {
    setMemoryStats((current) => {
      const next = recordStat(current, wasCorrect);
      void db.saveMemoryStats(next);
      return next;
    });
  }, []);

  const recordAiDrawChallenge = useCallback((wasCorrect: boolean, revealPercent: number) => {
    setAiDrawStats((current) => {
      const next = recordAiDrawRound(current, wasCorrect, revealPercent);
      void db.saveAiDrawStats(next);
      return next;
    });
  }, []);

  const renameClass = useCallback((id: ClassId, name: string) => {
    setClasses((current) => {
      const next = renameClassIn(current, id, name);
      void db.saveClasses(next);
      return next;
    });
  }, []);

  const changeEmoji = useCallback((id: ClassId, emoji: string | undefined) => {
    setClasses((current) => {
      const next = setEmojiIn(current, id, emoji);
      void db.saveClasses(next);
      return next;
    });
  }, []);

  const addClass = useCallback(
    (name: string, emoji: string | undefined): ClassId | null => {
      const created = createClass(classes, name, emoji);
      if (!created) return null;
      setClasses((current) => {
        const next = [...current, created];
        void db.saveClasses(next);
        return next;
      });
      return created.id;
    },
    [classes],
  );

  const deleteClass = useCallback(
    async (id: ClassId) => {
      // Forget the classifier's copy first, but never let that stop the rest:
      // leaving the category on screen with its data half-gone is far worse.
      try {
        ml.removeClass(id);
      } catch {
        // The classifier held nothing under this label; nothing to forget.
      }

      const {
        classes: nextClasses,
        examples: nextExamples,
        removedExampleIds,
      } = removeClassFrom(classes, examples, id);

      setClasses(nextClasses);
      setExamples(nextExamples);

      await Promise.all([
        db.saveClasses(nextClasses),
        ...removedExampleIds.map((exampleId) => db.deleteExample(exampleId)),
      ]);
    },
    [classes, examples],
  );

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
    setAiDrawStats(EMPTY_AI_DRAW_STATS);
    // Order matters, and callers must await this. Clearing memory alone made
    // the screen look reset while the examples were still on disk, so a
    // reload in that window handed the next child the previous one's
    // drawings. The examples go first, because they are the thing Reset has
    // to be sure about; a reload between the two later steps only costs a
    // fresh set of starter categories.
    await db.clearExamples();
    await db.clearMeta();
    await db.saveClasses(starter);
  }, []);

  return {
    modelStatus,
    storageAvailable,
    retryLoad: boot,
    classes,
    examples,
    counts,
    total,
    stats,
    memoryStats,
    aiDrawStats,
    trainedClasses,
    readyForChallenge,
    minExamplesPerClass: MIN_EXAMPLES_PER_CLASS,
    maxClasses: MAX_CLASSES,
    minClasses: MIN_CLASSES,
    canAddClass,
    canDeleteClass,
    teach,
    classify,
    recordChallenge,
    recordMemoryChallenge,
    recordAiDrawChallenge,
    renameClass,
    changeEmoji,
    addClass,
    deleteClass,
    pickRandomExample,
    reset,
  };
}

export type AiLab = ReturnType<typeof useAiLab>;
