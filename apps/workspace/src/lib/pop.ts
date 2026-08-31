import { useEffect, useRef } from 'react';

/** Closes a popover menu when the pointer lands anywhere outside it —
 *  attach the returned ref to the `.pop` wrapper. Escape closes too. */
export function useOutsideClose<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  close: () => void,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}
