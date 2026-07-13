import { createContext, useContext, useState, useCallback, useRef } from 'react'

// Minimal toast system — no dependency, matches the data-slate aesthetic.
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const push = useCallback((message, tone = 'info') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={`panel px-3 py-2 font-mono text-xs shadow-lg ${
              t.tone === 'error' ? 'border-imperial text-emberlight' : 'border-brass text-brasslight'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
