import { useEffect, useState } from 'react';
import type { ModelStatus } from '../types';

interface Props {
  status: ModelStatus;
  onRetry: () => void;
}

/** How long "Ready! 🎉" stays up before the screen steps out of the way. */
const CELEBRATE_MS = 800;
/** Matches the fade in app.css, so the node leaves once it is invisible. */
const FADE_MS = 400;

/**
 * The first thing anyone sees. It has one job: make it obvious that the AI is
 * being fetched, roughly how far along that is, and what to do if it fails.
 *
 * The percentage is stage-derived, never a download percentage -- MobileNet
 * is fetched through a helper that reports no bytes, and a made-up number
 * would be worse than an honest "step 2 of 4".
 */
export function Loader({ status, onRetry }: Props) {
  const ready = status.state === 'ready';
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>('showing');

  // Adjusting state during render, rather than in an effect: a retry after a
  // failed load has to be able to run the whole celebration again.
  const [wasReady, setWasReady] = useState(ready);
  if (wasReady !== ready) {
    setWasReady(ready);
    setPhase('showing');
  }

  useEffect(() => {
    if (!ready) return;
    const toLeaving = window.setTimeout(() => setPhase('leaving'), CELEBRATE_MS);
    const toGone = window.setTimeout(() => setPhase('gone'), CELEBRATE_MS + FADE_MS);
    return () => {
      window.clearTimeout(toLeaving);
      window.clearTimeout(toGone);
    };
  }, [ready]);

  if (ready && phase === 'gone') return null;

  const celebrating = ready;
  const percent = status.state === 'loading' ? status.progress.percent : 100;
  const stepText =
    status.state === 'loading'
      ? `Step ${status.progress.step} of ${status.progress.totalSteps}`
      : 'All steps done';
  const statusText = celebrating
    ? 'Ready! 🎉'
    : status.state === 'loading'
      ? status.progress.label
      : '';

  return (
    <div
      className={`loaderOverlay${phase === 'leaving' ? ' isLeaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={status.state === 'loading'}
    >
      <div className="loaderCard">
        {status.state === 'error' ? (
          <>
            <div className="loaderRobot" aria-hidden="true">
              😴
            </div>
            <h2 className="loaderTitle">AI couldn&rsquo;t finish loading.</h2>
            <p className="loaderStatus">Check the internet connection and try again.</p>
            <p className="loaderNote">
              The AI models are downloaded from the internet the first time the lab opens.
            </p>
            <button type="button" className="btn btnPrimary btnBig" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className={`loaderRobot${celebrating ? ' isReady' : ''}`} aria-hidden="true">
              🤖
            </div>
            <h2 className="loaderTitle">AI Doodle Lab</h2>
            <p className="loaderLead">
              {celebrating ? 'Your AI is ready!' : 'Getting your AI ready…'}
            </p>

            <div className="loaderProgress">
              <div
                className="loaderBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${stepText}: ${statusText}`}
                aria-label="Setup progress"
              >
                <span className="loaderBarFill" style={{ width: `${percent}%` }} />
              </div>
              <p className="loaderMeta">
                <span>{stepText}</span>
                <span className="loaderPercent">{percent}%</span>
              </p>
            </div>

            <p className="loaderStatus">{statusText}</p>

            {!celebrating && (
              <>
                <p className="loaderNote">This may take a moment the first time.</p>
                <p className="loaderFine">
                  First visit needs internet to load the AI models. Your browser may reuse
                  downloaded models on later visits.
                </p>
                <p className="loaderFine">
                  Once loaded, the AI runs on your device — your drawings stay here.
                </p>
                <p className="loaderFine loaderHonesty">
                  The bar shows setup steps, not download size.
                </p>
              </>
            )}
          </>
        )}

        <p className="loaderPartner">
          <img src="/fontys-ict.png" alt="" className="loaderPartnerMark" aria-hidden="true" />
          <span>Workshop for Fontys ICT</span>
        </p>
      </div>
    </div>
  );
}
