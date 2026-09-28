import { useState } from 'react';
import { useAiLab } from './hooks/useAiLab';
import type { Stage } from './types';
import { Stepper } from './components/Stepper';
import { TeachStage } from './components/TeachStage';
import { ChallengeMode } from './components/ChallengeMode';
import { LearnSection } from './components/LearnSection';
import { Loader } from './components/Loader';
import { ConfirmDialog } from './components/ConfirmDialog';

export default function App() {
  const lab = useAiLab();
  const [stage, setStage] = useState<Stage>('teach');
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="app">
      <header className="appHeader">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            🤖
          </span>
          <span className="brandText">
            <span className="brandTitle">AI Doodle Lab</span>
            <span className="brandSub">Draw it. Teach it. Test it.</span>
          </span>
        </div>
        <div className="headerRight">
          <span className="privacyPill">🔒 Runs on your device</span>
          <button type="button" className="btn btnGhost" onClick={() => setConfirmReset(true)}>
            Reset AI
          </button>
        </div>
      </header>

      <Stepper stage={stage} onChange={setStage} />

      <main className="appMain">
        {stage === 'teach' && <TeachStage lab={lab} />}
        {stage === 'challenge' && <ChallengeMode lab={lab} />}
        {stage === 'learn' && <LearnSection />}
      </main>

      <footer className="appFooter">
        🔒 Your drawings stay on this device. No accounts, no uploads, no tracking.
      </footer>

      <Loader status={lab.modelStatus} onRetry={lab.retryLoad} />

      {confirmReset && (
        <ConfirmDialog
          title="Reset your AI?"
          message="This deletes every example you taught and clears the challenge score. It cannot be undone."
          confirmLabel="Yes, reset everything"
          onConfirm={() => {
            void lab.reset();
            setConfirmReset(false);
            setStage('teach');
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
