// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção

/**
 * Non-blocking failure strip shown over the running app.
 *
 * A sidecar that dies after startup used to replace the whole UI with the
 * full-screen bootstrap shell, which destroyed the user's context and reset the
 * window to compact. The app stays usable; this only reports and offers a retry.
 */
export function BootstrapBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="bootstrap-banner" role="status">
      <span className="bootstrap-banner-icon" aria-hidden="true">!</span>
      <p className="bootstrap-banner-message">{message}</p>
      <div className="bootstrap-banner-actions">
        <button className="btn-secondary" type="button" onClick={onRetry}>
          Retry service
        </button>
        <button
          className="bootstrap-banner-close"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
