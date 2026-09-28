/**
 * The categories AI Draws can generate.
 *
 * These are pretrained Sketch-RNN models published by Google's Magenta team,
 * trained on the Quick, Draw! dataset. Nothing here is trained by, or has any
 * connection to, the child's own KNN categories -- this is a separate model
 * per category, downloaded on demand.
 *
 * Every entry in this list has been verified to download and produce a real
 * sketch. Do not add a category without checking it first: a 404 or a model
 * that generates nothing turns into a dead round for a child.
 */

const MODEL_HOST = 'https://storage.googleapis.com/quickdraw-models/sketchRNN/models';

/**
 * Groups exist purely so a round's wrong answers are plausible. "Cat / Dog /
 * Rabbit / Pig" is a real guess; "Cat / Helicopter / Cactus / Crab" is not.
 * Each group therefore needs at least four members.
 */
/**
 * Groups exist purely so a round's wrong answers are plausible. "Cat / Dog /
 * Rabbit / Pig" is a real guess; "Cat / Helicopter / Cactus / Crab" is not.
 * Each group therefore needs at least four members.
 */
export type SketchGroup = 'animals' | 'bugs' | 'sea' | 'vehicles' | 'plants';

export interface SketchModelDef {
  id: string;
  name: string;
  emoji: string;
  modelUrl: string;
  group: SketchGroup;
}

const define = (
  id: string,
  name: string,
  emoji: string,
  group: SketchGroup,
): SketchModelDef => ({ id, name, emoji, group, modelUrl: `${MODEL_HOST}/${id}.gen.json` });

export const SKETCH_MODELS: SketchModelDef[] = [
  define('cat', 'Cat', '🐱', 'animals'),
  define('dog', 'Dog', '🐶', 'animals'),
  define('rabbit', 'Rabbit', '🐰', 'animals'),
  define('pig', 'Pig', '🐷', 'animals'),
  define('sheep', 'Sheep', '🐑', 'animals'),
  define('owl', 'Owl', '🦉', 'animals'),
  define('penguin', 'Penguin', '🐧', 'animals'),
  define('duck', 'Duck', '🦆', 'animals'),

  define('bee', 'Bee', '🐝', 'bugs'),
  define('spider', 'Spider', '🕷️', 'bugs'),
  define('snail', 'Snail', '🐌', 'bugs'),
  define('mosquito', 'Mosquito', '🦟', 'bugs'),

  define('whale', 'Whale', '🐳', 'sea'),
  define('octopus', 'Octopus', '🐙', 'sea'),
  define('crab', 'Crab', '🦀', 'sea'),
  define('lobster', 'Lobster', '🦞', 'sea'),

  define('bus', 'Bus', '🚌', 'vehicles'),
  define('truck', 'Truck', '🚚', 'vehicles'),
  define('helicopter', 'Helicopter', '🚁', 'vehicles'),
  define('bicycle', 'Bicycle', '🚲', 'vehicles'),

  define('flower', 'Flower', '🌸', 'plants'),
  define('cactus', 'Cactus', '🌵', 'plants'),
  define('palm_tree', 'Palm tree', '🌴', 'plants'),
  define('pineapple', 'Pineapple', '🍍', 'plants'),
];

export const OPTIONS_PER_ROUND = 4;

export function findModel(id: string): SketchModelDef | undefined {
  return SKETCH_MODELS.find((model) => model.id === id);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface SketchRound {
  answer: SketchModelDef;
  options: SketchModelDef[];
}

/**
 * Builds one round: an answer plus three same-group distractors, shuffled.
 * `avoidIds` keeps the same category from coming up twice in a row (for
 * instance after a failed download, when we immediately pick again).
 */
export function pickRound(avoidIds: string[] = [], random: () => number = Math.random): SketchRound {
  const candidates = SKETCH_MODELS.filter((model) => !avoidIds.includes(model.id));
  const pool = candidates.length > 0 ? candidates : SKETCH_MODELS;
  const answer = pool[Math.floor(random() * pool.length)];

  const sameGroup = SKETCH_MODELS.filter(
    (model) => model.group === answer.group && model.id !== answer.id,
  );
  const distractors = shuffled(sameGroup, random).slice(0, OPTIONS_PER_ROUND - 1);

  // Every group ships four or more members, so this is defensive only: if one
  // ever shrinks, fill up from the rest of the list rather than show 2 buttons.
  if (distractors.length < OPTIONS_PER_ROUND - 1) {
    const chosen = new Set([answer.id, ...distractors.map((model) => model.id)]);
    for (const model of shuffled(SKETCH_MODELS, random)) {
      if (distractors.length >= OPTIONS_PER_ROUND - 1) break;
      if (chosen.has(model.id)) continue;
      chosen.add(model.id);
      distractors.push(model);
    }
  }

  return { answer, options: shuffled([answer, ...distractors], random) };
}
