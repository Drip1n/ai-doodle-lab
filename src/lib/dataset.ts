import {
  COLOR_PALETTE,
  MAX_CLASSES,
  STARTER_POOL,
  type ChallengeStats,
  type ClassId,
  type Example,
  type LearningClass,
} from '../types';

/**
 * Pure dataset/category logic, kept out of the React hook so the rules that
 * are easy to get wrong -- deletion, renaming, orphaned examples -- can be
 * tested directly.
 */

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Three random, unique starter categories -- re-rolled only on first run or reset. */
export function pickStarterClasses(random: () => number = Math.random): LearningClass[] {
  return shuffle(STARTER_POOL, random)
    .slice(0, 3)
    .map((pick, index) => ({
      id: pick.id,
      name: pick.name,
      emoji: pick.emoji,
      accent: COLOR_PALETTE[index % COLOR_PALETTE.length].accent,
      accentSoft: COLOR_PALETTE[index % COLOR_PALETTE.length].accentSoft,
    }));
}

export function nextColor(existing: LearningClass[]): { accent: string; accentSoft: string } {
  const used = new Set(existing.map((def) => def.accent));
  return (
    COLOR_PALETTE.find((color) => !used.has(color.accent)) ??
    COLOR_PALETTE[existing.length % COLOR_PALETTE.length]
  );
}

export function createClass(
  existing: LearningClass[],
  name: string,
  emoji: string | undefined,
  id: string = newId(),
): LearningClass | null {
  if (existing.length >= MAX_CLASSES) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const color = nextColor(existing);
  return {
    id,
    name: trimmed,
    // An empty choice means "no icon" and must stay empty, not fall back.
    emoji: emoji?.trim() ? emoji : undefined,
    accent: color.accent,
    accentSoft: color.accentSoft,
  };
}

/** Renaming must never change the id, because the KNN examples are keyed by it. */
export function renameClassIn(
  classes: LearningClass[],
  id: ClassId,
  name: string,
): LearningClass[] {
  return classes.map((def) => (def.id === id ? { ...def, name: name.trim() || def.name } : def));
}

export function setEmojiIn(
  classes: LearningClass[],
  id: ClassId,
  emoji: string | undefined,
): LearningClass[] {
  return classes.map((def) =>
    def.id === id ? { ...def, emoji: emoji?.trim() ? emoji : undefined } : def,
  );
}

export interface DeletionResult {
  classes: LearningClass[];
  examples: Example[];
  removedExampleIds: string[];
}

/** Removes a category together with every example taught under it. */
export function removeClassFrom(
  classes: LearningClass[],
  examples: Example[],
  id: ClassId,
): DeletionResult {
  return {
    classes: classes.filter((def) => def.id !== id),
    examples: examples.filter((example) => example.classId !== id),
    removedExampleIds: examples.filter((example) => example.classId === id).map((e) => e.id),
  };
}

/**
 * Examples whose category no longer exists (an interrupted delete, or data
 * left by an older version of the app) must never reach the classifier --
 * they would give it a label the UI cannot render.
 */
export function splitOrphanExamples(
  classes: LearningClass[],
  examples: Example[],
): { kept: Example[]; orphans: Example[] } {
  const known = new Set(classes.map((def) => def.id));
  const kept: Example[] = [];
  const orphans: Example[] = [];
  for (const example of examples) {
    if (known.has(example.classId)) kept.push(example);
    else orphans.push(example);
  }
  return { kept, orphans };
}

export function countExamples(
  classes: LearningClass[],
  examples: Example[],
): Record<ClassId, number> {
  const result: Record<ClassId, number> = {};
  for (const def of classes) result[def.id] = 0;
  for (const example of examples) {
    if (result[example.classId] === undefined) continue;
    result[example.classId] += 1;
  }
  return result;
}

export function recordStat(stats: ChallengeStats, wasCorrect: boolean): ChallengeStats {
  return {
    attempts: stats.attempts + 1,
    correct: stats.correct + (wasCorrect ? 1 : 0),
  };
}

/** The class the UI should fall back to when the selected one disappears. */
export function resolveSelection(
  classes: LearningClass[],
  selected: ClassId | null,
): ClassId | null {
  if (classes.length === 0) return null;
  if (selected && classes.some((def) => def.id === selected)) return selected;
  return classes[0].id;
}
