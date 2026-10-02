import { useEffect, useState } from 'react';
import type { AiLab } from '../hooks/useAiLab';
import type { ChallengeKind } from '../types';
import { DrawChallenge } from './DrawChallenge';
import { AiDrawChallenge } from './AiDrawChallenge';
import { MemoryChallenge } from './MemoryChallenge';
import { CreateChallenge } from './CreateChallenge';

const MODES: { kind: ChallengeKind; emoji: string; title: string; sub: string }[] = [
  { kind: 'create', emoji: '🎨', title: 'Let AI create', sub: 'AI creates from your drawings and ideas.' },
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
  create: { title: 'Your drawings, a new adventure!', sub: 'Choose something you taught your AI, then give it a little twist.' },
  draw: { title: 'Can your AI guess it?', sub: 'Draw anything your AI has learned.' },
  aidraw: {
    title: "Can you guess the AI's drawing?",
    sub: 'The AI will draw one line at a time. Guess before it finishes!',
  },
  memory: {
    title: 'Can you remember what the AI learned?',
    sub: 'Look at an example you taught the AI. Can you remember its label?',
  },
};

/**
 * A request from elsewhere in the app to open a particular challenge (the
 * Learn page's "Try AI Draws" button). The token makes a repeat request for
 * the same mode still count, and lets the child switch tabs freely afterwards.
 */
export interface ModeRequest {
  kind: ChallengeKind;
  token: number;
}

interface Props {
  lab: AiLab;
  onGoToTeach: () => void;
  modeRequest?: ModeRequest | null;
}

export function ChallengeMode({ lab, onGoToTeach, modeRequest }: Props) {
  const [kind, setKind] = useState<ChallengeKind>(modeRequest?.kind ?? 'draw');
  const heading = HEADINGS[kind];

  useEffect(() => {
    if (modeRequest) setKind(modeRequest.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeRequest?.token]);

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = MODES.findIndex((mode) => mode.kind === kind);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? MODES.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
    setKind(MODES[next].kind);
    document.getElementById(`challenge-tab-${MODES[next].kind}`)?.focus();
  };

  return (
    <div className="stage">
      <header className="stageHead">
        <h2 className="stageTitle">{heading.title}</h2>
        <p className="stageSub">{heading.sub}</p>
      </header>

      {/* Roving tabindex: the tab strip is one Tab stop, arrows move inside
          it, which is what a screen reader announces a tablist to do. */}
      <div
        className="challengeSwitch"
        role="tablist"
        aria-label="Challenge type"
        onKeyDown={onTabKeyDown}
      >
        {MODES.map((mode) => (
          <button
            key={mode.kind}
            type="button"
            role="tab"
            id={`challenge-tab-${mode.kind}`}
            aria-selected={kind === mode.kind}
            aria-controls={`challenge-panel-${mode.kind}`}
            tabIndex={kind === mode.kind ? 0 : -1}
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

      <div
        role="tabpanel"
        id={`challenge-panel-${kind}`}
        aria-labelledby={`challenge-tab-${kind}`}
        tabIndex={-1}
      >
        {kind === 'draw' && <DrawChallenge lab={lab} onGoToTeach={onGoToTeach} />}
        {kind === 'aidraw' && <AiDrawChallenge lab={lab} />}
        {kind === 'memory' && <MemoryChallenge lab={lab} onGoToTeach={onGoToTeach} />}
        {kind === 'create' && <CreateChallenge lab={lab} onGoToTeach={onGoToTeach} />}
      </div>
    </div>
  );
}
