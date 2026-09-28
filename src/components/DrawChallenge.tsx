import { useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ClassId, Prediction } from '../types';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { PredictionResult } from './PredictionResult';

type Phase = 'drawing' | 'thinking' | 'guessed' | 'correcting' | 'done';

const THINKING_MS = 650;

export function DrawChallenge({ lab, onGoToTeach }: { lab: AiLab; onGoToTeach: () => void }) {
  const [phase, setPhase] = useState<Phase>('drawing');
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [dirty, setDirty] = useState(false);
  const [outcome, setOutcome] = useState<'yes' | 'no' | null>(null);
  const [correctionId, setCorrectionId] = useState<ClassId | null>(null);
  const [taught, setTaught] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const embeddingRef = useRef<Float32Array | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const correctionClass = lab.classes.find((def) => def.id === correctionId) ?? null;
  const classesWithExamples = lab.classes.filter((def) => (lab.counts[def.id] ?? 0) > 0);

  const startOver = () => {
    setPrediction(null);
    setOutcome(null);
    setCorrectionId(null);
    setTaught(false);
    setError(null);
    embeddingRef.current = null;
    canvasRef.current?.clear();
    setDirty(false);
    setPhase('drawing');
  };

  const askAi = async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    setPhase('thinking');
    setError(null);
    try {
      const [{ prediction: result, embedding }] = await Promise.all([
        lab.classify(canvas),
        new Promise((resolve) => setTimeout(resolve, THINKING_MS)),
      ]);
      if (!mountedRef.current) return;
      embeddingRef.current = embedding;
      setPrediction(result);
      setPhase('guessed');
    } catch (guessError) {
      setPhase('drawing');
      setError(guessError instanceof Error ? guessError.message : 'The AI could not guess.');
    }
  };

  const sayYes = () => {
    setOutcome('yes');
    lab.recordChallenge(true);
  };

  const sayNo = () => {
    setOutcome('no');
    lab.recordChallenge(false);
    setPhase('correcting');
  };

  const teachFromMistake = async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas || !correctionId) return;
    try {
      await lab.teach(canvas, correctionId, 'mistake', embeddingRef.current ?? undefined);
      setTaught(true);
    } catch (teachError) {
      setError(teachError instanceof Error ? teachError.message : 'Could not save that example.');
    }
  };

  const successRate =
    lab.stats.attempts === 0 ? 0 : Math.round((lab.stats.correct / lab.stats.attempts) * 100);

  if (!lab.readyForChallenge) {
    return (
      <section className="panel lockPanel">
        <p className="lockEmoji" aria-hidden="true">
          🔐
        </p>
        <p className="lockText">
          Teach at least two categories {lab.minExamplesPerClass}+ examples each before starting
          this challenge.
        </p>
        <ul className="lockList">
          {lab.classes.map((def) => (
            <li key={def.id} className={(lab.counts[def.id] ?? 0) >= lab.minExamplesPerClass ? 'done' : ''}>
              <span aria-hidden="true">{def.emoji}</span> {def.name}: {lab.counts[def.id] ?? 0}/
              {lab.minExamplesPerClass}
              {(lab.counts[def.id] ?? 0) >= lab.minExamplesPerClass ? ' ✓' : ''}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btnPrimary" onClick={onGoToTeach}>
          Go teach it something
        </button>
      </section>
    );
  }

  return (
    <div className="workGrid">
      <section className="panel workspace">
        <DrawingCanvas
          ref={canvasRef}
          accent="var(--brand)"
          onDirtyChange={setDirty}
          disabled={phase !== 'drawing'}
        />

        {phase === 'drawing' && (
          <>
            <div className="workspaceActions">
              <button type="button" className="btn btnPrimary btnBig" onClick={askAi} disabled={!dirty}>
                🤖 Ask AI
              </button>
            </div>
            {!dirty && <p className="hintLine">Draw anything your AI has learned, then ask it to guess.</p>}
          </>
        )}

        {phase === 'thinking' && (
          <span className="thinking">
            <span className="spinner" aria-hidden="true" /> AI is thinking…
          </span>
        )}

        {(phase === 'guessed' || phase === 'correcting' || phase === 'done') && prediction && (
          <>
            <PredictionResult prediction={prediction} classes={classesWithExamples} />

            {phase === 'guessed' && (
              <div className="verdictAsk">
                <p className="verdictAskTitle">Was I right?</p>
                <div className="verdictAskActions">
                  <button type="button" className="btn btnPrimary" onClick={sayYes}>
                    ✓ Yes!
                  </button>
                  <button type="button" className="btn btnGhost" onClick={sayNo}>
                    ✕ No
                  </button>
                </div>
                <p className="feedbackNote">
                  You know the correct answer. Your feedback helps the AI learn.
                </p>
              </div>
            )}

            {outcome === 'yes' && (
              <div className="verdictOutcome isCorrect">
                <p className="verdictOutcomeTitle">🎉 Nice! Your AI got it right.</p>
                <button type="button" className="btn btnPrimary btnBig" onClick={startOver}>
                  Try another
                </button>
              </div>
            )}

            {outcome === 'no' && !taught && (
              <div className="verdictOutcome isWrong">
                <p className="verdictOutcomeTitle">Oops! What was it?</p>
                <p className="feedbackNote">
                  You know the correct answer. Your feedback helps the AI learn.
                </p>
                <div className="correctionGrid">
                  {lab.classes.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      className={`correctionOption${correctionId === def.id ? ' isActive' : ''}`}
                      style={{ '--accent': def.accent, '--accent-soft': def.accentSoft } as React.CSSProperties}
                      onClick={() => setCorrectionId(def.id)}
                    >
                      <span aria-hidden="true">{def.emoji}</span> {def.name}
                    </button>
                  ))}
                </div>
                {correctionClass && (
                  <div className="workspaceActions">
                    <button type="button" className="btn btnPrimary btnBig" onClick={teachFromMistake}>
                      Teach AI from this mistake
                    </button>
                    <button type="button" className="btn btnGhost" onClick={startOver}>
                      Skip, try another
                    </button>
                  </div>
                )}
              </div>
            )}

            {outcome === 'no' && taught && (
              <div className="verdictOutcome isTaught">
                <p className="verdictOutcomeTitle">🧠 Learned from my mistake!</p>
                <button type="button" className="btn btnPrimary btnBig" onClick={startOver}>
                  Try another
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className="errorLine">⚠️ {error}</p>}
      </section>

      <div className="sideColumn">
        <section className="panel">
          <h3 className="panelTitle">Challenge success rate</h3>
          <div className="scoreRow">
            <div className="scoreBox">
              <span className="scoreValue">{lab.stats.attempts}</span>
              <span className="scoreLabel">Challenges</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{lab.stats.correct}</span>
              <span className="scoreLabel">Correct</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{successRate}%</span>
              <span className="scoreLabel">Success rate</span>
            </div>
          </div>
          <p className="scoreNote">
            This score only shows how your AI performed on the challenges you tried.
          </p>
        </section>
      </div>
    </div>
  );
}
