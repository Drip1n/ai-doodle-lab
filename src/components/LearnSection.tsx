import { useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ClassId, Example, Prediction } from '../types';
import * as ml from '../ml/classifier';
import { toThumbnail } from '../ml/imageProcessing';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { DatasetSummary } from './DatasetSummary';

interface Props {
  lab: AiLab;
  onGoToTeach: (classId?: ClassId) => void;
  onGoToChallenge: () => void;
}

const PIPELINE_STAGES = [
  { id: 'drawing', emoji: '✏️', title: 'YOUR DRAWING', caption: 'What you made' },
  { id: 'eyes', emoji: '👁️', title: 'AI EYES', caption: 'Find visual patterns' },
  { id: 'memory', emoji: '🧠', title: 'AI MEMORY', caption: 'What you taught it' },
  { id: 'compare', emoji: '🔎', title: 'COMPARE', caption: 'Which learned examples look most similar?' },
  { id: 'guess', emoji: '🤖', title: 'GUESS', caption: 'Choose the closest category' },
] as const;

type CompareStage = 'idle' | 'image' | 'features' | 'neighbors' | 'prediction';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EXPERIMENTS = [
  {
    id: 'tiny',
    emoji: '🔍',
    title: 'Draw it tiny',
    instruction:
      'Next time you challenge your AI, draw your picture much smaller than usual, right in the middle of the canvas. Then ask it to guess.',
    goTo: 'challenge' as const,
  },
  {
    id: 'huge',
    emoji: '📐',
    title: 'Draw it huge',
    instruction: 'This time, fill almost the whole canvas with your drawing. Then ask the AI to guess.',
    goTo: 'challenge' as const,
  },
  {
    id: 'style',
    emoji: '🎨',
    title: 'Change the style',
    instruction:
      'Try a totally different style than before — thicker lines, more detail, or one simple outline. See if the AI still recognizes it.',
    goTo: 'challenge' as const,
  },
  {
    id: 'strange',
    emoji: '🙃',
    title: 'Draw it strangely',
    instruction: 'Draw it upside down, sideways, or from a weird angle. Can the AI still guess it?',
    goTo: 'challenge' as const,
  },
  {
    id: 'balance',
    emoji: '⚖️',
    title: 'Add more examples to one category',
    instruction: 'Go teach your AI a few more examples of your smallest category, then test it again.',
    goTo: 'teach' as const,
  },
];

export function LearnSection({ lab, onGoToTeach, onGoToChallenge }: Props) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------- A. pipeline ----------
  const [activeStage, setActiveStage] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [eyesOpen, setEyesOpen] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (activeStage >= PIPELINE_STAGES.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setActiveStage((value) => value + 1), 750);
    return () => window.clearTimeout(timer);
  }, [playing, activeStage]);

  const playPipeline = () => {
    setActiveStage(0);
    setPlaying(true);
  };

  // ---------- B. memory / balance ----------
  const sortedByCount = [...lab.classes].sort(
    (a, b) => (lab.counts[a.id] ?? 0) - (lab.counts[b.id] ?? 0),
  );
  const weakest = lab.total > 0 ? sortedByCount[0] : null;
  const strongestCount = Math.max(0, ...lab.classes.map((def) => lab.counts[def.id] ?? 0));
  const unbalanced =
    weakest !== null && strongestCount > 0 && (lab.counts[weakest.id] ?? 0) * 2 < strongestCount;

  // ---------- C. interactive comparison ----------
  const [compareStage, setCompareStage] = useState<CompareStage>('idle');
  const [compareThumb, setCompareThumb] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<{ example: Example; distance: number }[]>([]);
  const [comparePrediction, setComparePrediction] = useState<Prediction | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const runComparison = async (thumb: string, embedding: Float32Array, excludeId?: string) => {
    setCompareError(null);
    setComparePrediction(null);
    setNeighbors([]);
    setCompareThumb(thumb);
    setCompareStage('image');
    await delay(450);
    if (!mountedRef.current) return;
    setCompareStage('features');
    await delay(650);
    if (!mountedRef.current) return;
    setNeighbors(ml.nearestExamples(embedding, lab.examples, 3, excludeId));
    setCompareStage('neighbors');
    await delay(650);
    if (!mountedRef.current) return;
    try {
      const prediction = await ml.predict(
        embedding,
        lab.classes.map((def) => def.id),
      );
      if (!mountedRef.current) return;
      setComparePrediction(prediction);
    } catch {
      // Not enough examples yet to predict — the truthful comparison stops here.
    }
    setCompareStage('prediction');
  };

  const handleShowMe = async () => {
    const example = lab.pickRandomExample();
    if (!example) return;
    setDrawMode(false);
    await runComparison(example.thumbnail, example.embedding, example.id);
  };

  const handleCompareDrawing = async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    try {
      const embedding = await ml.embedToArray(canvas);
      await runComparison(toThumbnail(canvas), embedding);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : 'Could not process that drawing.');
    }
  };

  const guessDef = lab.classes.find((def) => def.id === comparePrediction?.classId) ?? null;

  // ---------- D. mini experiments ----------
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const experiment = EXPERIMENTS.find((item) => item.id === experimentId) ?? null;

  const tryExperiment = () => {
    if (!experiment) return;
    if (experiment.goTo === 'challenge') onGoToChallenge();
    else onGoToTeach(weakest?.id);
    setExperimentId(null);
  };

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">See how your AI learns</h2>
        <p className="stageSub">Let&rsquo;s look inside what you just built.</p>
      </header>

      {/* A. pipeline */}
      <section className="panel">
        <div className="learnSectionHead">
          <h3 className="panelTitle">The visual learning pipeline</h3>
          <button type="button" className="btn btnGhost" onClick={playPipeline} disabled={playing}>
            ▶ Play
          </button>
        </div>

        <div className="pipeline">
          {PIPELINE_STAGES.map((stageDef, index) => (
            <div key={stageDef.id} className="pipelineStepWrap">
              <div className={`pipelineStep${index <= activeStage ? ' isActive' : ''}`}>
                <span className="pipelineEmoji" aria-hidden="true">
                  {stageDef.emoji}
                </span>
                <span className="pipelineTitle">{stageDef.title}</span>
                <span className="pipelineCaption">{stageDef.caption}</span>
                {stageDef.id === 'memory' && (
                  <span className="pipelineMemoryCounts">
                    {lab.classes.map((def) => (
                      <span key={def.id} className="pipelineMemoryChip">
                        {def.emoji}×{lab.counts[def.id] ?? 0}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              {index < PIPELINE_STAGES.length - 1 && (
                <span className="pipelineArrow" aria-hidden="true">
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        <article className={`learnCard learnCardNested${eyesOpen ? ' isOpen' : ''}`}>
          <button
            type="button"
            className="learnToggle"
            onClick={() => setEyesOpen((value) => !value)}
            aria-expanded={eyesOpen}
          >
            <span className="learnEmoji" aria-hidden="true">
              👁️
            </span>
            <span className="learnTitle">What are AI eyes?</span>
            <span className="learnChevron" aria-hidden="true">
              {eyesOpen ? '−' : '+'}
            </span>
          </button>
          {eyesOpen && (
            <div className="learnBody">
              <p>
                The app uses a pretrained vision model (called MobileNet) to turn any image into a
                list of numbers describing visual patterns. It was never trained on your drawings —
                it only looks for patterns. Your examples teach the classifier which patterns belong
                to <em>your</em> categories.
              </p>
              <p>
                We&rsquo;re not training a whole vision network from scratch here — that would take
                far more data and time than a workshop has.
              </p>
            </div>
          )}
        </article>
      </section>

      {/* B. AI memory */}
      <DatasetSummary
        classes={lab.classes}
        counts={lab.counts}
        total={lab.total}
        title="Your AI memory"
      />
      {unbalanced && weakest && (
        <div className="panel memoryTip learnWarning">
          <p>
            ⚠️ Your AI has much less experience with <strong>{weakest.name}</strong>.
          </p>
          <button type="button" className="btn btnPrimary" onClick={() => onGoToTeach(weakest.id)}>
            Teach more {weakest.name}
          </button>
        </div>
      )}

      {/* C. interactive comparison */}
      <section className="panel">
        <h3 className="panelTitle">What happens with something new?</h3>
        <p className="hintLine">
          Pick one of your real examples, or draw something new, and watch the AI actually compare
          it.
        </p>

        <div className="compareActions">
          <button type="button" className="btn btnPrimary" onClick={handleShowMe} disabled={lab.total === 0}>
            Show me
          </button>
          <button type="button" className="btn btnGhost" onClick={() => setDrawMode((value) => !value)}>
            ✏️ Or draw something new
          </button>
        </div>

        {lab.total === 0 && <p className="hintLine">Teach your AI at least one example first.</p>}

        {drawMode && (
          <div className="compareDraw">
            <DrawingCanvas ref={canvasRef} onDirtyChange={setCanvasDirty} />
            <button
              type="button"
              className="btn btnPrimary btnBig"
              onClick={handleCompareDrawing}
              disabled={!canvasDirty}
            >
              Compare this drawing
            </button>
          </div>
        )}

        {compareError && <p className="errorLine">⚠️ {compareError}</p>}

        {compareStage !== 'idle' && (
          <div className="compareFlow">
            <div className="compareStep">
              <p className="compareStepLabel">1. The picture</p>
              {compareThumb && <img src={compareThumb} alt="What is being compared" className="compareThumb" />}
            </div>

            {(compareStage === 'features' || compareStage === 'neighbors' || compareStage === 'prediction') && (
              <div className="compareStep">
                <p className="compareStepLabel">2. AI eyes turn it into numbers</p>
                <div className="featureBars" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <span key={index} className="featureBar" style={{ animationDelay: `${index * 40}ms` }} />
                  ))}
                </div>
                <p className="compareStepNote">
                  (An illustration — not the AI&rsquo;s literal internal numbers.)
                </p>
              </div>
            )}

            {(compareStage === 'neighbors' || compareStage === 'prediction') && (
              <div className="compareStep">
                <p className="compareStepLabel">3. Closest learned examples</p>
                {neighbors.length === 0 ? (
                  <p className="hintLine">Not enough other examples yet to compare against.</p>
                ) : (
                  <div className="neighborRow">
                    {neighbors.map((neighbor, index) => {
                      const def = lab.classes.find((c) => c.id === neighbor.example.classId);
                      return (
                        <div key={neighbor.example.id} className="neighborCard">
                          <img src={neighbor.example.thumbnail} alt={def?.name ?? 'example'} className="neighborThumb" />
                          <span className="neighborRank">
                            {index === 0 ? 'Closest' : `#${index + 1} closest`}
                          </span>
                          <span className="neighborLabel">
                            {def?.emoji} {def?.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {compareStage === 'prediction' && (
              <div className="compareStep">
                <p className="compareStepLabel">4. The guess</p>
                {guessDef ? (
                  <p className="compareGuess">
                    Based on the closest examples, the AI guesses:{' '}
                    <strong style={{ color: guessDef.accent }}>
                      {guessDef.emoji} {guessDef.name}
                    </strong>
                  </p>
                ) : (
                  <p className="hintLine">Not enough examples yet for the AI to guess confidently.</p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* D. mini experiments */}
      <section className="panel">
        <h3 className="panelTitle">Mini experiments</h3>
        <div className="experimentGrid">
          {EXPERIMENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`experimentCard${experimentId === item.id ? ' isActive' : ''}`}
              onClick={() => setExperimentId(item.id)}
            >
              <span className="experimentEmoji" aria-hidden="true">
                {item.emoji}
              </span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        {experiment && (
          <div className="experimentDetail">
            <p>{experiment.instruction}</p>
            <button type="button" className="btn btnPrimary btnBig" onClick={tryExperiment}>
              Try this experiment
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
