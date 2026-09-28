export type ClassId = 'cat' | 'house' | 'tree';

export const CLASS_IDS: ClassId[] = ['cat', 'house', 'tree'];

export interface ClassDef {
  id: ClassId;
  /** Editable by the child. */
  name: string;
  emoji: string;
  /** CSS colour used to give every class its own identity. */
  accent: string;
  accentSoft: string;
}

export const DEFAULT_CLASSES: Record<ClassId, ClassDef> = {
  cat: {
    id: 'cat',
    name: 'Cat',
    emoji: '🐱',
    accent: '#F2704B',
    accentSoft: '#FFEDE6',
  },
  house: {
    id: 'house',
    name: 'House',
    emoji: '🏠',
    accent: '#3D7EF2',
    accentSoft: '#E7F0FF',
  },
  tree: {
    id: 'tree',
    name: 'Tree',
    emoji: '🌳',
    accent: '#27A567',
    accentSoft: '#E3F7EC',
  },
};

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

export interface Prediction {
  classId: ClassId;
  confidences: Record<ClassId, number>;
}

export interface ChallengeStats {
  attempts: number;
  correct: number;
}

export type Stage = 'teach' | 'challenge' | 'learn';

export type ModelStatus =
  | { state: 'loading'; message: string }
  | { state: 'ready' }
  | { state: 'error'; message: string };
