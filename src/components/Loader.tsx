import type { ModelStatus } from '../types';

interface Props {
  status: ModelStatus;
  onRetry: () => void;
}

export function Loader({ status, onRetry }: Props) {
  if (status.state === 'ready') return null;

  return (
    <div className="loaderOverlay" role="status" aria-live="polite">
      <div className="loaderCard">
        {status.state === 'loading' ? (
          <>
            <div className="loaderRobot" aria-hidden="true">
              🤖
            </div>
            <h2 className="loaderTitle">Getting your AI ready…</h2>
            <p className="loaderStatus">{status.message}</p>
            <div className="loaderBar">
              <span />
            </div>
            <p className="loaderNote">🔒 Your drawings stay on this device.</p>
          </>
        ) : (
          <>
            <div className="loaderRobot" aria-hidden="true">
              😵
            </div>
            <h2 className="loaderTitle">The AI could not wake up</h2>
            <p className="loaderStatus">{status.message}</p>
            <p className="loaderNote">
              The vision model is downloaded once from the internet. Check the connection and try
              again.
            </p>
            <button type="button" className="btn btnPrimary btnBig" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
