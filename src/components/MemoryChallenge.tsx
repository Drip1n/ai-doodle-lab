import { useEffect, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ClassId, Example } from '../types';

const AUTO_REVEAL_MS = 2200;

export function MemoryChallenge({ lab, onGoToTeach }: { lab: AiLab; onGoToTeach: () => void }) {
  const [current, setCurrent] = useState<Example | null>(null);
  const [imageRevealed, setImageRevealed] = useState(false);
  const [answerId, setAnswerId] = useState<ClassId | null>(null);

  const ready = lab.examples.length > 0 && lab.classes.length >= 2;

  const pickNew = () => {
    setCurrent(lab.pickRandomExample());
    setImageRevealed(false);
    setAnswerId(null);
  };

  useEffect(() => {
    if (ready && !current) pickNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!current || imageRevealed) return;
    const timer = window.setTimeout(() => setImageRevealed(true), AUTO_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [current, imageRevealed]);

  if (!ready) {
    return (
      <section className="panel lockPanel">
        <p className="lockEmoji" aria-hidden="true">
          🧠
        </p>
        <p className="lockText">
          Teach your AI at least two categories first, then come back to test your memory.
        </p>
        <button type="button" className="btn btnPrimary" onClick={onGoToTeach}>
          Go teach it something
        </button>
      </section>
    );
  }

  if (!current) return null;

  const correctDef = lab.classes.find((def) => def.id === current.classId);
  const answered = answerId !== null;
  const wasCorrect = answered && answerId === current.classId;
  const successRate =
    lab.memoryStats.attempts === 0
      ? 0
      : Math.round((lab.memoryStats.correct / lab.memoryStats.attempts) * 100);

  return (
    <div className="workGrid">
      <section className="panel workspace memoryWorkspace">
        <div className="memoryStage">
          <img
            src={current.thumbnail}
            alt="A stored training example"
            className={`memoryStageImage${imageRevealed ? ' isRevealed' : ''}`}
          />
          {!imageRevealed && (
            <button type="button" className="btn btnGhost memoryRevealBtn" onClick={() => setImageRevealed(true)}>
              👀 Reveal
            </button>
          )}
        </div>

        <p className="memoryDisclaimer">
          This isn&rsquo;t the AI creating a new picture — you&rsquo;re looking at something it
          learned from.
        </p>

        <p className="verdictAskTitle">What did the AI learn this as?</p>
        <div className="correctionGrid">
          {lab.classes.map((def) => (
            <button
              key={def.id}
              type="button"
              className={`correctionOption${answerId === def.id ? ' isActive' : ''}`}
              style={{ '--accent': def.accent, '--accent-soft': def.accentSoft } as React.CSSProperties}
              disabled={answered}
              onClick={() => {
                setAnswerId(def.id);
                setImageRevealed(true);
                lab.recordMemoryChallenge(def.id === current.classId);
              }}
            >
              <span aria-hidden="true">{def.emoji}</span> {def.name}
            </button>
          ))}
        </div>

        {answered && correctDef && (
          <div className={`verdictOutcome ${wasCorrect ? 'isCorrect' : 'isWrong'}`}>
            <p className="memoryRevealFact">
              This example was taught to the AI as{' '}
              <strong>
                {correctDef.emoji} {correctDef.name}
              </strong>
              .
            </p>
            <p className="verdictOutcomeTitle">
              {wasCorrect ? '🎉 You remembered!' : `Almost! This was taught as ${correctDef.name}.`}
            </p>
            <button type="button" className="btn btnPrimary btnBig" onClick={pickNew}>
              Try another
            </button>
          </div>
        )}
      </section>

      <div className="sideColumn">
        <section className="panel">
          <h3 className="panelTitle">Memory challenge score</h3>
          <div className="scoreRow">
            <div className="scoreBox">
              <span className="scoreValue">{lab.memoryStats.attempts}</span>
              <span className="scoreLabel">Rounds</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{lab.memoryStats.correct}</span>
              <span className="scoreLabel">Remembered</span>
            </div>
            <div className="scoreBox">
              <span className="scoreValue">{successRate}%</span>
              <span className="scoreLabel">Success rate</span>
            </div>
          </div>
          <p className="scoreNote">
            This is a separate score from the classifier challenge — it tests your memory, not the
            AI&rsquo;s.
          </p>
        </section>
      </div>
    </div>
  );
}
