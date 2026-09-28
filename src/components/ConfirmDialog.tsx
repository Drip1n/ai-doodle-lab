import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Move focus into the dialog, and put it back where it came from on close,
  // so keyboard users are never left tabbing around behind the overlay.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Rendered into <body>: an ancestor with a transform (the stage's entry
  // animation) would otherwise become the containing block for this fixed
  // overlay and push the dialog off-screen.
  return createPortal(
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modalCard">
        <h2 className="modalTitle">{title}</h2>
        <p className="modalText">{message}</p>
        <div className="modalActions">
          <button type="button" className="btn btnGhost" ref={cancelRef} onClick={onCancel}>
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
