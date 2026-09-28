import { useState } from 'react';
import { useAiLab } from './hooks/useAiLab';
import type { ChallengeKind, ClassId, Stage } from './types';
import { Stepper } from './components/Stepper';
import { TeachStage, type FocusRequest } from './components/TeachStage';
import { ChallengeMode, type ModeRequest } from './components/ChallengeMode';
import { LearnSection } from './components/LearnSection';
import { Loader } from './components/Loader';
import { ConfirmDialog } from './components/ConfirmDialog';

export default function App() {
  const lab = useAiLab();
  const [stage, setStage] = useState<Stage>('teach');
  const [confirmReset, setConfirmReset] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [modeRequest, setModeRequest] = useState<ModeRequest | null>(null);

  const goToTeach = (classId?: ClassId) => {
    setStage('teach');
    if (classId) setFocusRequest({ classId, token: Date.now() });
  };

  /**
   * Callers that care which challenge they land on say so; everyone else
   * still gets You Draw, which is where the workshop starts.
   */
  const goToChallenge = (kind?: ChallengeKind) => {
    setStage('challenge');
    if (kind) setModeRequest({ kind, token: Date.now() });
  };

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
          <span className="brandPartner">
            <img src="/fontys-ict.png" alt="Fontys ICT" className="brandPartnerMark" />
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

      {!lab.storageAvailable && (
        <p className="storageWarning" role="status">
          ⚠️ This browser is not saving your work. Everything still works, but the examples
          disappear when you close the tab.
        </p>
      )}

      <main className="appMain">
        {stage === 'teach' && <TeachStage lab={lab} focusRequest={focusRequest} />}
        {stage === 'challenge' && (
          <ChallengeMode lab={lab} modeRequest={modeRequest} onGoToTeach={() => goToTeach()} />
        )}
        {stage === 'learn' && (
          <LearnSection lab={lab} onGoToTeach={goToTeach} onGoToChallenge={goToChallenge} />
        )}
      </main>

      <footer className="appFooter">
        <p>
          🔒 Your drawings stay on this device. No accounts, nothing sent to our server, no
          tracking.
        </p>
        <p className="appFooterPartner">Built for a Fontys ICT workshop</p>
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
