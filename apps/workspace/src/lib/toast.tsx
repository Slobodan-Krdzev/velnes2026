import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** The prototype's #toast: one element, bottom-center, 2.4s. */
const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast" hidden={!msg} role="status">
        {msg}
      </div>
    </ToastContext.Provider>
  );
}
