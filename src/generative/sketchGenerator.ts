import * as tf from '@tensorflow/tfjs';
import type { SketchModelDef } from './supportedModels';
import {
  countPoints,
  fitLines,
  strokesToLines,
  type RawStroke,
  type SketchLine,
} from './strokeUtils';

/**
 * A minimal Sketch-RNN decoder.
 *
 * This is a *generator*, not a classifier: it has nothing to do with
 * ml/classifier.ts, MobileNet or the child's KNN examples. It loads one of
 * Magenta's pretrained per-category checkpoints and samples a brand new
 * sequence of pen strokes from it, one step at a time.
 *
 * Only the decoding half of Magenta's sketch-rnn is reproduced here (the
 * published checkpoints are decoder-only anyway). The `@magenta/sketch`
 * package itself pins TensorFlow.js 1.x, which would drag a second, much
 * older copy of TF into the bundle alongside the 4.x the classifier uses, so
 * we implement the ~100 lines we actually need instead.
 *
 * Model format (a 3-element JSON array):
 *   [0] info    { mode, version, max_seq_len, name, scale_factor }
 *   [1] shapes  [[512,123], [123], [5,2048], [512,2048], [2048]]
 *   [2] weights base64 int16, dequantised by (10 * w) / 32767
 */

/** 20 Gaussians in the mixture density output -- fixed by the checkpoints. */
const NUM_MIXTURES = 20;

/** Bigger numbers draw smaller sketches; 2.0 is Magenta's own default. */
const PIXEL_FACTOR = 2.0;

/** Lower is tidier and more recognisable; higher is wilder. */
const DEFAULT_TEMPERATURE = 0.45;

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** A sketch with fewer real points than this is treated as a failed sample. */
const MIN_USABLE_POINTS = 12;

/** Sampling is random, so a dud now and then is normal -- just draw again. */
const MAX_SAMPLE_ATTEMPTS = 3;

export interface SketchModelInfo {
  mode: number;
  version: number;
  max_seq_len: number;
  name: string;
  scale_factor: number;
}

interface LstmState {
  c: Float32Array;
  h: Float32Array;
}

export interface LoadedSketchModel {
  def: SketchModelDef;
  info: SketchModelInfo;
  numUnits: number;
  scaleFactor: number;
  outputKernel: tf.Tensor2D;
  outputBias: tf.Tensor1D;
  lstmKernel: tf.Tensor2D;
  lstmBias: tf.Tensor1D;
  forgetBias: tf.Scalar;
  /** Bytes downloaded, so the UI and the README can quote a real number. */
  byteLength: number;
}

export interface GeneratedSketch {
  /** Absolute polylines, already fitted to the requested canvas size. */
  lines: SketchLine[];
  totalPoints: number;
  /** How many decoder steps were sampled (for diagnostics). */
  steps: number;
}

export class SketchGenerationError extends Error {}

// ---------- weight decoding ----------

function base64ToInt16(encoded: string): Int16Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function dequantise(encoded: string): Float32Array {
  const raw = base64ToInt16(encoded);
  const weights = new Float32Array(raw.length);
  // Weights were stored clipped to +/-10 and quantised into int16.
  for (let i = 0; i < raw.length; i += 1) weights[i] = (10 * raw[i]) / 32767;
  return weights;
}

// ---------- sampling helpers ----------

function gaussRandom(random: () => number): number {
  let u = 0;
  let v = 0;
  let r = 0;
  do {
    u = 2 * random() - 1;
    v = 2 * random() - 1;
    r = u * u + v * v;
  } while (r === 0 || r > 1);
  return u * Math.sqrt((-2 * Math.log(r)) / r);
}

/** Draws (x, y) from a correlated 2-D Gaussian. */
function biGaussRandom(
  muX: number,
  muY: number,
  sigmaX: number,
  sigmaY: number,
  corr: number,
  random: () => number,
): [number, number] {
  const z1 = gaussRandom(random);
  const z2 = gaussRandom(random);
  return [
    Math.sqrt(1 - corr * corr) * sigmaX * z1 + corr * sigmaX * z2 + muX,
    sigmaY * z2 + muY,
  ];
}

function sampleCategorical(probabilities: Float32Array, random: () => number): number {
  const target = random();
  let accumulated = 0;
  for (let i = 0; i < probabilities.length; i += 1) {
    accumulated += probabilities[i];
    if (accumulated >= target) return i;
  }
  return probabilities.length - 1;
}

// ---------- loading ----------

const cache = new Map<string, LoadedSketchModel>();
const inFlight = new Map<string, Promise<LoadedSketchModel>>();

export function isModelCached(id: string): boolean {
  return cache.has(id);
}

function buildModel(
  def: SketchModelDef,
  payload: unknown,
  byteLength: number,
): LoadedSketchModel {
  if (!Array.isArray(payload) || payload.length < 3) {
    throw new SketchGenerationError('That drawing model is in an unexpected format.');
  }
  const [info, shapes, weightStrings] = payload as [SketchModelInfo, number[][], string[]];
  if (!info || !Array.isArray(shapes) || shapes.length < 5 || !Array.isArray(weightStrings)) {
    throw new SketchGenerationError('That drawing model is in an unexpected format.');
  }

  const weights = weightStrings.map(dequantise);
  for (let i = 0; i < 5; i += 1) {
    const expected = shapes[i].reduce((a, b) => a * b, 1);
    if (!weights[i] || weights[i].length !== expected) {
      throw new SketchGenerationError('That drawing model is in an unexpected format.');
    }
  }

  const numUnits = shapes[0][0];
  const outputKernel = tf.tensor2d(weights[0], shapes[0] as [number, number]);
  const outputBias = tf.tensor1d(weights[1]);
  // The checkpoint stores the input-to-hidden and hidden-to-hidden halves of
  // the LSTM kernel separately; basicLSTMCell wants them stacked.
  const kernelXH = tf.tensor2d(weights[2], shapes[2] as [number, number]);
  const kernelHH = tf.tensor2d(weights[3], shapes[3] as [number, number]);
  const lstmKernel = tf.concat2d([kernelXH, kernelHH], 0);
  kernelXH.dispose();
  kernelHH.dispose();
  const lstmBias = tf.tensor1d(weights[4]);

  return {
    def,
    info,
    numUnits,
    scaleFactor: info.scale_factor / PIXEL_FACTOR,
    outputKernel,
    outputBias,
    lstmKernel,
    lstmBias,
    forgetBias: tf.scalar(1),
    byteLength,
  };
}

/**
 * Downloads and instantiates one category's model. Cached in memory, so a
 * second round with the same category costs nothing. The browser's HTTP cache
 * covers repeat visits (the host sends `cache-control: public, max-age=3600`).
 */
export async function loadSketchModel(def: SketchModelDef): Promise<LoadedSketchModel> {
  const cached = cache.get(def.id);
  if (cached) return cached;

  const pending = inFlight.get(def.id);
  if (pending) return pending;

  const request = (async () => {
    await tf.ready();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let bytes: ArrayBuffer;
    try {
      const response = await fetch(def.modelUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new SketchGenerationError(`That drawing idea couldn't load (${response.status}).`);
      }
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (error instanceof SketchGenerationError) throw error;
      throw new SketchGenerationError("That drawing idea couldn't be downloaded.");
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new SketchGenerationError('That drawing model could not be read.');
    }

    const model = buildModel(def, payload, bytes.byteLength);
    cache.set(def.id, model);
    return model;
  })();

  inFlight.set(def.id, request);
  try {
    return await request;
  } finally {
    inFlight.delete(def.id);
  }
}

/** Frees every cached model's tensors. */
export function disposeSketchModels(): void {
  for (const model of cache.values()) {
    model.outputKernel.dispose();
    model.outputBias.dispose();
    model.lstmKernel.dispose();
    model.lstmBias.dispose();
    model.forgetBias.dispose();
  }
  cache.clear();
}

// ---------- generation ----------

function step(model: LoadedSketchModel, stroke: RawStroke, state: LstmState): LstmState {
  const output = tf.tidy(() => {
    const x = tf.tensor2d(
      [stroke[0] / model.scaleFactor, stroke[1] / model.scaleFactor, stroke[2], stroke[3], stroke[4]],
      [1, 5],
    );
    const c = tf.tensor2d(state.c, [1, model.numUnits]);
    const h = tf.tensor2d(state.h, [1, model.numUnits]);
    const next = tf.basicLSTMCell(model.forgetBias, model.lstmKernel, model.lstmBias, x, c, h);
    return tf.concat(next, 1);
  });
  const data = output.dataSync() as Float32Array;
  output.dispose();
  return {
    c: data.slice(0, model.numUnits),
    h: data.slice(model.numUnits, model.numUnits * 2),
  };
}

interface MixtureDensity {
  pi: Float32Array;
  muX: Float32Array;
  muY: Float32Array;
  sigmaX: Float32Array;
  sigmaY: Float32Array;
  corr: Float32Array;
  pen: Float32Array;
}

/**
 * The decoder's output layer: a 20-component Gaussian mixture over the next
 * pen offset, plus a 3-way distribution over "pen down / pen up / finished".
 */
function mixtureDensity(
  model: LoadedSketchModel,
  state: LstmState,
  temperature: number,
): MixtureDensity {
  const softmaxTemperature = 0.5 + temperature * 0.5;
  const output = tf.tidy(() => {
    const h = tf.tensor2d(state.h, [1, model.numUnits]);
    const z = tf.add(tf.matMul(h, model.outputKernel), model.outputBias).squeeze();
    const [rawPen, rest] = tf.split(z, [3, NUM_MIXTURES * 6]);
    const [rawPi, muX, muY, rawSigmaX, rawSigmaY, rawCorr] = tf.split(rest, 6);
    const softTemp = tf.scalar(softmaxTemperature);
    const sqrtTemp = tf.scalar(Math.sqrt(temperature));
    return tf.concat([
      tf.softmax(rawPi.div(softTemp)),
      muX,
      muY,
      tf.exp(rawSigmaX).mul(sqrtTemp),
      tf.exp(rawSigmaY).mul(sqrtTemp),
      tf.tanh(rawCorr),
      tf.softmax(rawPen.div(softTemp)),
    ]);
  });
  const values = output.dataSync() as Float32Array;
  output.dispose();
  const at = (index: number) => values.slice(index * NUM_MIXTURES, (index + 1) * NUM_MIXTURES);
  return {
    pi: at(0),
    muX: at(1),
    muY: at(2),
    sigmaX: at(3),
    sigmaY: at(4),
    corr: at(5),
    pen: values.slice(6 * NUM_MIXTURES, 6 * NUM_MIXTURES + 3),
  };
}

function sampleStroke(
  model: LoadedSketchModel,
  pdf: MixtureDensity,
  random: () => number,
): RawStroke {
  const index = sampleCategorical(pdf.pi, random);
  const [dx, dy] = biGaussRandom(
    pdf.muX[index],
    pdf.muY[index],
    pdf.sigmaX[index],
    pdf.sigmaY[index],
    pdf.corr[index],
    random,
  );
  const penIndex = sampleCategorical(pdf.pen, random);
  const pen: [number, number, number] = [0, 0, 0];
  pen[penIndex] = 1;
  return [dx * model.scaleFactor, dy * model.scaleFactor, pen[0], pen[1], pen[2]];
}

export interface GenerateOptions {
  /** Side length of the square canvas the sketch should fit into. */
  size: number;
  padding?: number;
  temperature?: number;
  random?: () => number;
}

/**
 * Samples one brand new sketch. Every call produces a different drawing --
 * nothing is replayed from the Quick, Draw! dataset, and no stored image is
 * involved.
 *
 * The whole sequence is sampled up front (a few hundred milliseconds) so the
 * caller can fit it to the canvas and know the total length before animating.
 */
export function generateSketch(
  model: LoadedSketchModel,
  options: GenerateOptions,
): GeneratedSketch {
  let lastError: SketchGenerationError | null = null;
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt += 1) {
    try {
      return sampleOnce(model, options);
    } catch (error) {
      if (!(error instanceof SketchGenerationError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new SketchGenerationError('The drawing came out empty.');
}

function sampleOnce(model: LoadedSketchModel, options: GenerateOptions): GeneratedSketch {
  const random = options.random ?? Math.random;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const maxSteps = Math.max(1, model.info.max_seq_len ?? 200);

  const strokes: RawStroke[] = [];
  let state: LstmState = {
    c: new Float32Array(model.numUnits),
    h: new Float32Array(model.numUnits),
  };
  // Sketch-RNN's start token: no movement, pen touching the paper.
  let stroke: RawStroke = [0, 0, 1, 0, 0];
  let steps = 0;

  for (; steps < maxSteps; steps += 1) {
    state = step(model, stroke, state);
    stroke = sampleStroke(model, mixtureDensity(model, state, temperature), random);
    if (!Number.isFinite(stroke[0]) || !Number.isFinite(stroke[1])) {
      throw new SketchGenerationError('The drawing came out scrambled.');
    }
    strokes.push(stroke);
    if (stroke[4] === 1) break;
  }

  const lines = strokesToLines(strokes);
  const fitted = fitLines(lines, options.size, options.padding ?? Math.round(options.size * 0.08));
  const totalPoints = countPoints(fitted);
  if (totalPoints < MIN_USABLE_POINTS) {
    throw new SketchGenerationError('The drawing came out empty.');
  }
  return { lines: fitted, totalPoints, steps: steps + 1 };
}
