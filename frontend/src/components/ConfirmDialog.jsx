export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Bekräfta',
  cancelLabel = 'Avbryt',
  destructive = false,
  onConfirm,
  onCancel
}) {
  const confirmStyle = destructive
    ? { background: 'var(--berry)', borderColor: 'var(--berry-deep)', color: 'var(--paper)' }
    : undefined;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn btn-sm btn-ghost" onClick={onCancel} aria-label="Stäng">×</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>{message}</p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button
            className="btn btn-primary"
            style={confirmStyle}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
