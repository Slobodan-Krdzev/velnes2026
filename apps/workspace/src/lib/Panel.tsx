import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Panels launched from inside the sticky settings pane must escape
 *  its stacking context (position:sticky always creates one) or the
 *  topbar paints over their buttons. The prototype keeps its #panel
 *  at document root for the same reason. */
export function PanelPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
