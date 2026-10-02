import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import {
  generateSketch,
  isModelCached,
  loadSketchModel,
  releaseSketchModel,
  retainSketchModel,
  SketchGenerationError,
  type GeneratedSketch,
} from '../generative/sketchGenerator';
import { pickRound, type SketchModelDef, type SketchRound } from '../generative/supportedModels';
import { revealPercent } from '../generative/strokeUtils';
import { AiSketchCanvas, SKETCH_CANVAS_SIZE } from './AiSketchCanvas';

/**
 * AI Draws: a pretrained Sketch-RNN generator invents a new drawing and the
 * child guesses what it is. This is the mirror image of the You Draw
 * challenge -- generation instead of classification -- and it deliberately
 * shares nothing with the child's own classifier.
 */

type Phase =
  | { kind: 'idle' }
  /** `firstDownload` is decided before the fetch starts, so the message
      cannot flip to "downloading" for a model already in memory. */
  | { kind: 'preparing'; firstDownload: boolean }
  | { kind: 'drawing' }
  | { kind: 'waiting' }
  | { kind: 'solved'; percent: number }
  | { kind: 'revealed' }
  | { kind: 'failed'; message: string };

/** Roughly how long a whole drawing should take to appear. */
const MIN_DRAW_SECONDS = 3;
const MAX_DRAW_SECONDS = 7;
const POINTS_PER_SECOND_TARGET = 20;

const OFFLINE_MESSAGE =
  'AI Draws needs internet the first time it loads a drawing model. Check the connection and try again.';

function drawSeconds(totalPoints: number): number {
  return Math.min(
    MAX_DRAW_SECONDS,
    Math.max(MIN_DRAW_SECONDS, totalPoints / POINTS_PER_SECOND_TARGET),
  );
}

export function AiDrawChallenge({ lab }: { lab: AiLab }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [round, setRound] = useState<SketchRound | null>(null);
  const [sketch, setSketch] = useState<GeneratedSketch | null>(null);
  const [revealedPoints, setRevealedPoints] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const shownRef = useRef(0);
  const resolvedRef = useRef(false);
  const mountedRef = useRef(true);
  const roundTokenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startRound = useCallback(
    async (avoidIds: string[] = []) => {
      const token = roundTokenRef.current + 1;
      roundTokenRef.current = token;
      const next = pickRound(avoidIds);
      resolvedRef.current = false;
      shownRef.current = 0;
      setRound(next);
      setSketch(null);
      setRevealedPoints(0);
      setWrongIds([]);
      setPaused(false);
      setPhase({ kind: 'preparing', firstDownload: !isModelCached(next.answer.id) });

      // Hold the model in the bounded cache for as long as this round needs
      // it, so a later category can never dispose the one being drawn from.
      retainSketchModel(next.answer.id);
      try {
        const model = await loadSketchModel(next.answer);
        // Sampling the sequence blocks for a few hundred milliseconds, so let
        // the "getting ready" message paint before we start.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!mountedRef.current || roundTokenRef.current !== token) return;
        const generated = generateSketch(model, { size: SKETCH_CANVAS_SIZE });
        if (!mountedRef.current || roundTokenRef.current !== token) return;
        setSketch(generated);
        setPhase({ kind: 'drawing' });
      } catch (error) {
        if (!mountedRef.current || roundTokenRef.current !== token) return;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        setPhase({
          kind: 'failed',
          message: offline
            ? OFFLINE_MESSAGE
            : error instanceof SketchGenerationError
              ? error.message
              : "That drawing idea couldn't load.",
        });
      } finally {
        // The finished sketch is plain coordinates; the model itself is only
        // needed up to here, so the cache is free to reclaim it again.
        releaseSketchModel(next.answer.id);
      }
    },
    [],
  );

  const finishUnsolved = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    lab.recordAiDrawChallenge(false, 0);
    setPhase({ kind: 'revealed' });
  }, [lab]);

  // Reveal the sketch point by point. Driven by elapsed time rather than
  // frame count so pause, resume and "draw faster" all stay honest.
  useEffect(() => {
    if (phase.kind !== 'drawing' || paused || !sketch) return;
    const perSecond = (sketch.totalPoints / drawSeconds(sketch.totalPoints)) * (fast ? 2.5 : 1);
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      shownRef.current = Math.min(sketch.totalPoints, shownRef.current + perSecond * elapsed);
      setRevealedPoints(Math.floor(shownRef.current));
      if (shownRef.current >= sketch.totalPoints) {
        setPhase({ kind: 'waiting' });
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase.kind, paused, fast, sketch]);

  const guess = (option: SketchModelDef) => {
    if ((phase.kind !== 'drawing' && phase.kind !== 'waiting') || !round || !sketch || resolvedRef.current) return;
    if (option.id !== round.answer.id) {
      setWrongIds((current) => [...current, option.id]);
      return;
    }
    const percent = revealPercent(revealedPoints, sketch.totalPoints);
    resolvedRef.current = true;
    // Let them see the finished drawing they just recognised.
    shownRef.current = sketch.totalPoints;
    setRevealedPoints(sketch.totalPoints);
    setPhase({ kind: 'solved', percent });
    lab.recordAiDrawChallenge(true, percent);
  };

  const answer = round?.answer ?? null;
  const showAnswer = phase.kind === 'solved' || phase.kind === 'revealed';
  const stats = lab.aiDrawStats;
  const averageReveal =
    stats.correct === 0 ? 0 : Math.round(stats.revealPercentSum / stats.correct);

  return (
    <div className="workGrid">
      <section className="panel workspace">
        {phase.kind === 'idle' && (
          <div className="aiDrawIntro">
            <p className="aiDrawIntroEmoji" aria-hidden="true">
              🤖
            </p>
            <p className="lockText">Ready to see the AI draw?</p>
            <button
              type="button"
              className="btn btnPrimary btnBig"
              onClick={() => void startRound()}
            >
              Start drawing
            </button>
          </div>
        )}

        {phase.kind === 'preparing' && (
          <div className="aiDrawIntro" role="status">
            <p className="aiDrawIntroEmoji" aria-hidden="true">
              🤖
            </p>
            <p className="lockText">Getting a new drawing idea ready…</p>
            <p className="hintLine">
              {phase.firstDownload
                ? 'Downloading this drawing model for the first time (about 3 MB).'
                : 'Preparing the drawing…'}
            </p>
            <span className="thinking">
              <span className="spinner" aria-hidden="true" /> Please wait
            </span>
          </div>
        )}

        {phase.kind === 'failed' && (
          <div className="aiDrawIntro">
            <p className="aiDrawIntroEmoji" aria-hidden="true">
              🙈
            </p>
            <p className="lockText">That drawing idea couldn&rsquo;t load.</p>
            <p className="hintLine">{phase.message}</p>
            <button
              type="button"
              className="btn btnPrimary btnBig"
              onClick={() => void startRound(round ? [round.answer.id] : [])}
            >
              Try another
            </button>
          </div>
        )}

        {sketch && round && phase.kind !== 'preparing' && phase.kind !== 'failed' && (
          <>
            <div className="canvasFrame">
              <AiSketchCanvas lines={sketch.lines} revealedPoints={revealedPoints} />
            </div>

            {phase.kind === 'drawing' && (
              <div className="aiDrawControls">
                <button
                  type="button"
                  className="btn btnGhost"
                  onClick={() => setPaused((value) => !value)}
                >
                  {paused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button
                  type="button"
                  className={`btn btnGhost${fast ? ' isActive' : ''}`}
                  onClick={() => setFast((value) => !value)}
                  aria-pressed={fast}
                >
                  ⏩ Draw faster
                </button>
              </div>
            )}

            {phase.kind === 'waiting' && <p className="hintLine" role="status">Drawing finished. Take your time and choose an answer!</p>}
            {(phase.kind === 'drawing' || phase.kind === 'waiting') && <button type="button" className="btn btnGhost" onClick={() => { if (sketch) { shownRef.current = sketch.totalPoints; setRevealedPoints(sketch.totalPoints); } finishUnsolved(); }}>Show me the answer</button>}
            <p className="verdictAskTitle">What is it?</p>
            <div className="guessGrid">
              {round.options.map((option) => {
                const wrong = wrongIds.includes(option.id);
                const isAnswer = showAnswer && option.id === round.answer.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`guessOption${wrong ? ' isWrong' : ''}${isAnswer ? ' isAnswer' : ''}`}
                    disabled={showAnswer || wrong || (phase.kind !== 'drawing' && phase.kind !== 'waiting')}
                    onClick={() => guess(option)}
                  >
                    <span className="guessEmoji" aria-hidden="true">
                      {option.emoji}
                    </span>
                    <span className="guessName">{option.name}</span>
                    {/* A mark as well as a colour, so the outcome reads for
                        anyone who cannot tell the two borders apart. */}
                    {(wrong || isAnswer) && (
                      <span className="guessMark">{isAnswer ? '✓ Correct' : '✕ Not this one'}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {(phase.kind === 'drawing' || phase.kind === 'waiting') && wrongIds.length > 0 && (
              <p className="aiDrawNudge">Not quite — try another answer!</p>
            )}

            {phase.kind === 'solved' && answer && (
              <div className="verdictOutcome isCorrect">
                <p className="verdictOutcomeTitle">🎉 You got it!</p>
                <p className="aiDrawReveal">
                  You guessed <strong>{answer.name.toUpperCase()}</strong> after only{' '}
                  <strong>{phase.percent}%</strong> of the drawing.
                </p>
                <p className="scoreNote">
                  That percentage is how much of the drawing had appeared — not how sure the AI was.
                </p>
                <button
                  type="button"
                  className="btn btnPrimary btnBig"
                  onClick={() => void startRound([answer.id])}
                >
                  Draw another
                </button>
              </div>
            )}

            {phase.kind === 'revealed' && answer && (
              <div className="verdictOutcome isWrong">
                <p className="verdictOutcomeTitle">
                  That was a {answer.name.toUpperCase()} {answer.emoji}
                </p>
                <button
                  type="button"
                  className="btn btnPrimary btnBig"
                  onClick={() => void startRound([answer.id])}
                >
                  Draw another
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <div className="sideColumn">
        <section className="panel">
          <h3 className="panelTitle">AI Draws score</h3>
          <div className="scoreRow">
            <div className="scoreBox">
              <span className="scoreValue">{stats.rounds}</span>
              <span className="scoreLabel">Rounds</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{stats.correct}</span>
              <span className="scoreLabel">Correct</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{stats.correct === 0 ? '—' : `${averageReveal}%`}</span>
              <span className="scoreLabel">Average guess</span>
            </div>
          </div>
          <p className="scoreNote">
            &ldquo;Average guess&rdquo; is how much of the drawing was on screen when you got it
            right. It is a progress measurement, not model accuracy.
          </p>
        </section>

        <article className={`learnCard${explainerOpen ? ' isOpen' : ''}`}>
          <button
            type="button"
            className="learnToggle"
            onClick={() => setExplainerOpen((value) => !value)}
            aria-expanded={explainerOpen}
          >
            <span className="learnEmoji" aria-hidden="true">
              🤔
            </span>
            <span className="learnTitle">How is this different?</span>
            <span className="learnChevron" aria-hidden="true">
              {explainerOpen ? '−' : '+'}
            </span>
          </button>
          {explainerOpen && (
            <div className="learnBody">
              <h4 className="aiDrawExplainHead">✏️ You Draw</h4>
              <p>
                You make a picture. The classifier compares it with your examples and guesses the
                category.
              </p>
              <h4 className="aiDrawExplainHead">🤖 AI Draws</h4>
              <p>
                The generator learned patterns from many sketches and creates a new sequence of pen
                strokes.
              </p>
              <p>
                <strong>These are two different AI jobs: recognizing and generating.</strong>
              </p>
              <p>
                The drawing model was trained beforehand on a large collection of human sketches. It
                has never seen the examples you taught your own AI.
              </p>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
