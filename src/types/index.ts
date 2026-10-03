import type { LoadProgress } from '../ml/loadStages';

/**
 * Classes are data-driven so a workshop can teach any set of categories.
 * `id` is generated once and never changes — renaming or re-emoji-ing a
 * class must not disturb the KNN examples stored under that id.
 */
export type ClassId = string;

export interface LearningClass {
  id: ClassId;
  /** Editable by the child. */
  name: string;
  /** Undefined means "no icon" -- the name is then shown on its own. */
  emoji?: string;
  /** CSS colour used to give every class its own identity. */
  accent: string;
  accentSoft: string;
}

/** Kept as an alias so existing component props read naturally. */
export type ClassDef = LearningClass;

export const MAX_CLASSES = 6;
export const MIN_CLASSES = 2;

/** Colour identities handed out to classes in creation order. */
export const COLOR_PALETTE: { accent: string; accentSoft: string }[] = [
  { accent: '#F2704B', accentSoft: '#FFEDE6' },
  { accent: '#3D7EF2', accentSoft: '#E7F0FF' },
  { accent: '#27A567', accentSoft: '#E3F7EC' },
  { accent: '#E0518F', accentSoft: '#FDE8F1' },
  { accent: '#D6A400', accentSoft: '#FFF6DB' },
  { accent: '#8B5CF6', accentSoft: '#EFE8FE' },
  { accent: '#06A5C0', accentSoft: '#E1F8FC' },
  { accent: '#E0483D', accentSoft: '#FEE9E9' },
];

/** A pool the app randomly draws the first-run starter categories from. */
export const STARTER_POOL: { id: string; name: string; emoji: string }[] = [
  { id: 'cat', name: 'Cat', emoji: '🐱' },
  { id: 'house', name: 'House', emoji: '🏠' },
  { id: 'tree', name: 'Tree', emoji: '🌳' },
  { id: 'car', name: 'Car', emoji: '🚗' },
  { id: 'flower', name: 'Flower', emoji: '🌸' },
  { id: 'star', name: 'Star', emoji: '⭐' },
  { id: 'fish', name: 'Fish', emoji: '🐟' },
  { id: 'sun', name: 'Sun', emoji: '☀️' },
  { id: 'rocket', name: 'Rocket', emoji: '🚀' },
  { id: 'apple', name: 'Apple', emoji: '🍎' },
  { id: 'heart', name: 'Heart', emoji: '❤️' },
  { id: 'glasses', name: 'Glasses', emoji: '👓' },
];

/** A small, kid-friendly preset grid rather than a full emoji library. */
export const EMOJI_PRESETS: string[] = [
  '🐱', '🏠', '🌳', '🚗', '🌸', '⭐', '🐟', '☀️', '🚀', '🍎', '❤️', '👓',
  '🐶', '🐢', '🦋', '🍕', '🎈', '🎵', '⚽', '🌈', '🦄', '🍩', '🐸', '🎩',
];

export type ExampleSource = 'drawing' | 'upload' | 'mistake';

/** One human-made training example. */
export interface Example {
  id: string;
  classId: ClassId;
  /** Small PNG data URL shown on the memory wall. */
  thumbnail: string;
  /** MobileNet embedding, kept so the classifier can be rebuilt on reload. */
  embedding: Float32Array;
  createdAt: number;
  source: ExampleSource;
}

/**
 * The most recent picture the image-making AI actually produced.
 *
 * It belongs to the workshop session, not to the Create panel: a child who
 * wanders off to Memory and comes back must find their picture still there.
 * Only the latest one is kept -- this is deliberately not a gallery.
 *
 * `prompt`, `categoryId` and `categoryName` are a snapshot taken when the
 * picture arrived, so changing a look or a world afterwards can never leave
 * an older image sitting under a caption that no longer describes it.
 */
export interface GeneratedPicture {
  /** A `data:` image, or an `https:` URL the provider returned. */
  image: string;
  categoryId: ClassId;
  categoryName: string;
  prompt: string;
  createdAt: number;
  /** Where the temporary phone copy lives on our API, when there is one. */
  sharePath?: string;
  /** Epoch milliseconds after which that phone link is gone. */
  shareExpiresAt?: number;
}

export interface Prediction {
  classId: ClassId;
  confidences: Record<ClassId, number>;
}

export interface ChallengeStats {
  attempts: number;
  correct: number;
}

/**
 * AI Draws is scored separately from the classifier and memory challenges:
 * it measures the child against a pretrained generator, not their own AI.
 * `revealPercentSum` only accumulates rounds that were guessed correctly --
 * an unsolved round has no meaningful "guessed after N%" to record.
 */
export interface AiDrawStats {
  rounds: number;
  correct: number;
  revealPercentSum: number;
}

export type Stage = 'teach' | 'challenge' | 'learn';

export type ChallengeKind = 'draw' | 'aidraw' | 'memory' | 'create';

export type ModelStatus =
  | { state: 'loading'; progress: LoadProgress }
  | { state: 'ready' }
  /**
   * No message: a failed download has nothing useful to say to a child, and
   * the raw exception text is never something we want on screen.
   */
  | { state: 'error' };
