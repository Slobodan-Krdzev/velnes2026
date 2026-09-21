import type { ReactNode } from 'react';

/**
 * One sentence about location, where the person is looking.
 *
 * The first version put this in muted grey under the price chips —
 * a screen away from the "Near me" button that had just gone
 * disabled — and Alex read it as "nothing happens". A notice about a
 * control belongs beside the control, and a warning must not be
 * dressed as a footnote. Not in the prototype: there is no prototype
 * state for "the browser is blocking location".
 */
export function GeoNotice({
  children,
  action,
  icon = 'pin-off',
}: {
  children: ReactNode;
  action?: ReactNode;
  /** The notice is about location (default) or about the clock. */
  icon?: 'pin-off' | 'clock';
}) {
  return (
    <div className="geo-notice" role="status">
      {icon === 'clock' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z" /><path d="M4 4l16 16" /></svg>
      )}
      <span>
        {children}
        {action ? <> {action}.</> : null}
      </span>
    </div>
  );
}
