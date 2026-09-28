import { useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ChallengeKind } from '../types';
import { DrawChallenge } from './DrawChallenge';
import { AiDrawChallenge } from './AiDrawChallenge';
import { MemoryChallenge } from './MemoryChallenge';

const MODES: { kind: ChallengeKind; emoji: string; title: string; sub: string }[] = [
  { kind: 'draw', emoji: '✏️', title: 'You draw', sub: 'You draw. AI guesses.' },
  { kind: 'aidraw', emoji: '🤖', title: 'AI draws', sub: 'AI draws. You guess.' },
  {
    kind: 'memory',
    emoji: '🧠',
    title: 'Memory',
    sub: 'Can you remember what the AI learned?',
  },
];

const HEADINGS: Record<ChallengeKind, { title: string; sub: string }> = {
  draw: { title: 'Can your AI guess it?', sub: 'Draw anything your AI has learned.' },
  aidraw: {
    title: "Can you guess the AI's drawing?",
    sub: 'The AI will draw one line at a time. Guess before it finishes!',
  },
  memory: {
    title: 'Can you remember what the AI learned?',
    sub: 'Look at something you taught it, before it was taught.',
  },
};

export function ChallengeMode({ lab, onGoToTeach }: { lab: AiLab; onGoToTeach: () => void }) {
  const [kind, setKind] = useState<ChallengeKind>('draw');
  const heading = HEADINGS[kind];

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">{heading.title}</h2>
        <p className="stageSub">{heading.sub}</p>
      </header>

      <div className="challengeSwitch" role="tablist" aria-label="Challenge type">
        {MODES.map((mode) => (
          <button
            key={mode.kind}
            type="button"
            role="tab"
            aria-selected={kind === mode.kind}
            className={`challengeSwitchBtn${kind === mode.kind ? ' isActive' : ''}`}
            onClick={() => setKind(mode.kind)}
          >
            <span className="challengeSwitchEmoji" aria-hidden="true">
              {mode.emoji}
            </span>
            <span className="challengeSwitchTitle">{mode.title}</span>
            <span className="challengeSwitchSub">{mode.sub}</span>
          </button>
        ))}
      </div>

      {kind === 'draw' && <DrawChallenge lab={lab} onGoToTeach={onGoToTeach} />}
      {kind === 'aidraw' && <AiDrawChallenge lab={lab} />}
      {kind === 'memory' && <MemoryChallenge lab={lab} onGoToTeach={onGoToTeach} />}
    </div>
  );
}
