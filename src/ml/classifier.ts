import * as tf from '@tensorflow/tfjs';
import * as mobilenetModule from '@tensorflow-models/mobilenet';
import * as knnClassifier from '@tensorflow-models/knn-classifier';
import { CLASS_IDS, type ClassId, type Prediction } from '../types';
import { toModelCanvas } from './imageProcessing';

/**
 * MobileNet is the AI's pretrained "eyes": it turns any picture into a list of
 * numbers (an embedding). The KNN classifier is the part the child teaches --
 * it just remembers the embeddings of their examples and compares new drawings
 * against them. We never retrain MobileNet itself.
 */

let model: mobilenetModule.MobileNet | null = null;
let loadPromise: Promise<void> | null = null;
const knn = knnClassifier.create();

export const EMBEDDING_ONLY = true;

export async function loadModel(onStatus?: (message: string) => void): Promise<void> {
  if (model) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onStatus?.('Waking up the graphics engine…');
    await tf.ready();
    onStatus?.('Loading AI vision…');
    model = await mobilenetModule.load({ version: 1, alpha: 1.0 });
    onStatus?.('Warming up…');
  })();

  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    model = null;
    throw error;
  }
}

export function isModelReady(): boolean {
  return model !== null;
}

/**
 * Turns a drawing or uploaded image into a MobileNet embedding.
 * The caller owns the returned tensor and must dispose it.
 */
export function embed(source: HTMLCanvasElement | HTMLImageElement): tf.Tensor {
  if (!model) throw new Error('The AI is not ready yet.');
  const square = toModelCanvas(source);
  // tidy() cleans up every intermediate tensor; only the result survives.
  return tf.tidy(() => model!.infer(square, EMBEDDING_ONLY));
}

/** Embedding as a plain array, so it can be stored and replayed later. */
export async function embedToArray(
  source: HTMLCanvasElement | HTMLImageElement,
): Promise<Float32Array> {
  const tensor = embed(source);
  try {
    return (await tensor.data()) as Float32Array;
  } finally {
    tensor.dispose();
  }
}

export function addExample(embedding: Float32Array, classId: ClassId): void {
  const tensor = tf.tensor(embedding, [1, embedding.length]);
  try {
    knn.addExample(tensor, classId);
  } finally {
    tensor.dispose();
  }
}

export async function predict(embedding: Float32Array): Promise<Prediction> {
  if (knn.getNumClasses() === 0) {
    throw new Error('The AI has no examples yet.');
  }
  const tensor = tf.tensor(embedding, [1, embedding.length]);
  try {
    const result = await knn.predictClass(tensor, 5);
    const confidences = {} as Record<ClassId, number>;
    for (const id of CLASS_IDS) {
      confidences[id] = result.confidences[id] ?? 0;
    }
    return { classId: result.label as ClassId, confidences };
  } finally {
    tensor.dispose();
  }
}

export function resetClassifier(): void {
  knn.clearAllClasses();
}

/** Rebuilds the classifier from stored examples (used after a page reload). */
export function rebuildFrom(examples: { embedding: Float32Array; classId: ClassId }[]): void {
  knn.clearAllClasses();
  for (const example of examples) {
    addExample(example.embedding, example.classId);
  }
}

export function trainedClassCount(): number {
  return knn.getNumClasses();
}
