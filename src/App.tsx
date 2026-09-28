import { useState } from 'react';
import { useAiLab } from './hooks/useAiLab';
import type { ClassId, Stage } from './types';
import { Stepper } from './components/Stepper';
import { TeachStage, type FocusRequest } from './components/TeachStage';
import { ChallengeMode } from './components/ChallengeMode';
import { LearnSection } from './components/LearnSection';
import { Loader } from './components/Loader';
import { ConfirmDialog } from './components/ConfirmDialog';

export default function App() {
  const lab = useAiLab();
  const [stage, setStage] = useState<Stage>('teach');
  const [confirmReset, setConfirmReset] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const goToTeach = (classId?: ClassId) => {
    setStage('teach');
    if (classId) setFocusRequest({ classId, token: Date.now() });
  };
  const goToChallenge = () => setStage('challenge');

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
        {stage === 'teach' && <TeachStage lab={lab} focusRequest={focusRequest} />}
        {stage === 'challenge' && <ChallengeMode lab={lab} onGoToTeach={() => goToTeach()} />}
        {stage === 'learn' && (
          <LearnSection lab={lab} onGoToTeach={goToTeach} onGoToChallenge={goToChallenge} />
        )}
      </main>

      <footer className="appFooter">
        🔒 Your drawings stay on this device. No accounts, no uploads, no tracking.
      </footer>

      <Loader status={lab.modelStatus} onRetry={lab.retryLoad} />

      {confirmReset && (
        <ConfirmDialog
          title="Reset your AI?"
          message="This deletes every example, your custom categories, and both challenge scores, then picks a fresh set of starter categories. It cannot be undone."
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
