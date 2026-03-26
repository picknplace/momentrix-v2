'use client';

import { createContext, useCallback, useContext, useState, ReactNode, useRef } from 'react';
import { Button } from './button';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | undefined>(undefined);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setOpts(options);
    return new Promise(resolve => { resolveRef.current = resolve; });
  }, []);

  function handleClose(result: boolean) {
    resolveRef.current?.(result);
    setOpts(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => handleClose(false)}
        >
          <div
            className="bg-[#1E293B] border border-mx-border-light rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {opts.title && (
              <h3 className="text-base font-bold mb-3 text-mx-text">{opts.title}</h3>
            )}
            <p className="text-sm text-mx-text-secondary mb-5 whitespace-pre-wrap">{opts.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => handleClose(false)}>
                {opts.cancelText || '취소'}
              </Button>
              <Button
                variant={opts.variant || 'primary'}
                size="sm"
                onClick={() => handleClose(true)}
              >
                {opts.confirmText || '확인'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
