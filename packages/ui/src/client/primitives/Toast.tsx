import React, { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastTone = "default" | "go" | "warn" | "stop";

export interface ToastOptions {
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toneBorderClass(tone: ToastTone): string {
  switch (tone) {
    case "go":
      return "border-go-500/40";
    case "warn":
      return "border-warn-500/40";
    case "stop":
      return "border-stop-500/40";
    default:
      return "border-edge";
  }
}

export interface ToastProviderProps {
  children?: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = ++idRef.current;
      const tone: ToastTone = opts?.tone ?? "default";
      const durationMs = opts?.durationMs ?? 3000;
      setToasts((list) => [...list, { id, message, tone }]);
      setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        data-testid="toast-container"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            data-testid="toast"
            className={[
              "flex items-center gap-2 bg-ink-850 border rounded-md px-3 py-2 shadow-soft-drop font-sans text-[12px] pointer-events-auto",
              toneBorderClass(t.tone),
            ].join(" ")}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
