import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Rendered into <body>: an ancestor with a transform (the stage's entry
  // animation) would otherwise become the containing block for this fixed
  // overlay and push the dialog off-screen.
  return createPortal(
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modalCard">
        <h2 className="modalTitle">{title}</h2>
        <p className="modalText">{message}</p>
        <div className="modalActions">
          <button type="button" className="btn btnGhost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btnDanger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
