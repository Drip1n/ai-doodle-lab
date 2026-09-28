interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
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
    </div>
  );
}
