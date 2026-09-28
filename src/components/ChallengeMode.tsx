import { useEffect, useRef, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import { CLASS_IDS, type ClassId, type Prediction } from '../types';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { PredictionResult } from './PredictionResult';

type Phase = 'idle' | 'drawing' | 'thinking' | 'result';

const THINKING_MS = 650;

export function ChallengeMode({ lab }: { lab: AiLab }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<ClassId | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [dirty, setDirty] = useState(false);
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

  const classOf = (id: ClassId | null) => lab.classes.find((def) => def.id === id) ?? null;
  const targetClass = classOf(target);
  const guessedClass = classOf(prediction?.classId ?? null);
  const correct = prediction !== null && prediction.classId === target;

  const startChallenge = () => {
    const next = CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];
    setTarget(next);
    setPrediction(null);
    setTaught(false);
    setError(null);
    embeddingRef.current = null;
    canvasRef.current?.clear();
    setDirty(false);
    setPhase('drawing');
  };

  const guess = async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas || !target) return;
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
      setPhase('result');
      lab.recordChallenge(result.classId === target);
    } catch (guessError) {
      setPhase('drawing');
      setError(guessError instanceof Error ? guessError.message : 'The AI could not guess.');
    }
  };

  const teachFromMistake = async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas || !target) return;
    try {
      await lab.teach(canvas, target, 'mistake', embeddingRef.current ?? undefined);
      setTaught(true);
    } catch (teachError) {
      setError(teachError instanceof Error ? teachError.message : 'Could not save that example.');
    }
  };

  const successRate =
    lab.stats.attempts === 0 ? 0 : Math.round((lab.stats.correct / lab.stats.attempts) * 100);

  if (!lab.readyForChallenge) {
    return (
      <div className="stage">
        <header className="stageHead">
          <h2 className="stageTitle">Can your AI guess it?</h2>
          <p className="stageSub">First the AI needs a little experience with every category.</p>
        </header>
        <section className="panel lockPanel">
          <p className="lockEmoji" aria-hidden="true">
            🔐
          </p>
          <p className="lockText">
            Teach each category at least {lab.minExamplesPerClass} examples before starting the
            challenge.
          </p>
          <ul className="lockList">
            {lab.classes.map((def) => (
              <li key={def.id} className={lab.counts[def.id] >= lab.minExamplesPerClass ? 'done' : ''}>
                <span aria-hidden="true">{def.emoji}</span> {def.name}: {lab.counts[def.id]}/
                {lab.minExamplesPerClass}
                {lab.counts[def.id] >= lab.minExamplesPerClass ? ' ✓' : ''}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">Can your AI guess it?</h2>
        <p className="stageSub">Draw the challenge without telling the AI what it is.</p>
      </header>

      <div className="workGrid">
        <section className="panel workspace">
          {phase === 'idle' && (
            <div className="challengeStart">
              <p className="challengeStartEmoji" aria-hidden="true">
                🎯
              </p>
              <button type="button" className="btn btnPrimary btnBig" onClick={startChallenge}>
                Give me a challenge
              </button>
            </div>
          )}

          {phase !== 'idle' && targetClass && (
            <>
              <p
                className="challengeBanner"
                style={{ background: targetClass.accentSoft, color: targetClass.accent }}
              >
                🎯 Draw a {targetClass.name.toUpperCase()} {targetClass.emoji}
              </p>

              <DrawingCanvas
                ref={canvasRef}
                accent={targetClass.accent}
                onDirtyChange={setDirty}
                disabled={phase !== 'drawing'}
              />

              <div className="workspaceActions">
                {phase === 'drawing' && (
                  <button
                    type="button"
                    className="btn btnPrimary btnBig"
                    onClick={guess}
                    disabled={!dirty}
                  >
                    🤖 Let AI guess
                  </button>
                )}
                {phase === 'thinking' && (
                  <span className="thinking">
                    <span className="spinner" aria-hidden="true" /> AI is thinking…
                  </span>
                )}
                {phase === 'result' && (
                  <button type="button" className="btn btnPrimary btnBig" onClick={startChallenge}>
                    Try another challenge
                  </button>
                )}
              </div>
              {!dirty && phase === 'drawing' && (
                <p className="hintLine">Draw the challenge, then let the AI guess.</p>
              )}
              {error && <p className="errorLine">⚠️ {error}</p>}
            </>
          )}
        </section>

        <div className="sideColumn">
          {prediction && targetClass && (
            <section className={`panel verdict ${correct ? 'isCorrect' : 'isWrong'}`}>
              <p className="verdictTitle">
                {correct ? '🎉 Correct!' : '😅 Not quite!'}
              </p>
              <p className="verdictText">
                {correct
                  ? 'Your AI recognized it!'
                  : `I guessed ${guessedClass?.name.toUpperCase()}, but you were drawing ${targetClass.name.toUpperCase()}.`}
              </p>

              <PredictionResult prediction={prediction} classes={lab.classes} />

              {!correct && (
                <div className="mistakeBox">
                  <p className="mistakeText">Mistakes can become new training examples.</p>
                  {taught ? (
                    <p className="mistakeDone">
                      🧠 Added to {targetClass.name} — your AI just gained experience.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn btnPrimary"
                      style={{ background: targetClass.accent }}
                      onClick={teachFromMistake}
                    >
                      Teach AI from this mistake
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

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
    </div>
  );
}
