import { useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import { DrawChallenge } from './DrawChallenge';
import { MemoryChallenge } from './MemoryChallenge';

type ChallengeKind = 'draw' | 'memory';

export function ChallengeMode({ lab, onGoToTeach }: { lab: AiLab; onGoToTeach: () => void }) {
  const [kind, setKind] = useState<ChallengeKind>('draw');

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">
          {kind === 'draw' ? 'Can your AI guess it?' : 'Can you remember what the AI learned?'}
        </h2>
        <p className="stageSub">
          {kind === 'draw'
            ? 'Draw anything your AI has learned.'
            : 'Look at something you taught it, before it was taught.'}
        </p>
      </header>

      <div className="challengeSwitch" role="tablist" aria-label="Challenge type">
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'draw'}
          className={`challengeSwitchBtn${kind === 'draw' ? ' isActive' : ''}`}
          onClick={() => setKind('draw')}
        >
          <span className="challengeSwitchEmoji" aria-hidden="true">
            ✏️
          </span>
          <span className="challengeSwitchTitle">You draw</span>
          <span className="challengeSwitchSub">You draw. AI guesses.</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'memory'}
          className={`challengeSwitchBtn${kind === 'memory' ? ' isActive' : ''}`}
          onClick={() => setKind('memory')}
        >
          <span className="challengeSwitchEmoji" aria-hidden="true">
            🧠
          </span>
          <span className="challengeSwitchTitle">Memory challenge</span>
          <span className="challengeSwitchSub">Can you remember what the AI learned?</span>
        </button>
      </div>

      {kind === 'draw' ? (
        <DrawChallenge lab={lab} onGoToTeach={onGoToTeach} />
      ) : (
        <MemoryChallenge lab={lab} onGoToTeach={onGoToTeach} />
      )}
    </div>
  );
}
