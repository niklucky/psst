import { useEffect, useRef, useState } from 'react';

/** Seconds to hold the clipboard before clearing it. */
const CLEAR_AFTER_SECONDS = 30;

interface Props {
  value: string;
  label?: string;
  className?: string;
}

/**
 * One-click copy to clipboard.
 * Shows a countdown after copying, then clears the clipboard automatically.
 */
export function CopyButton({ value, label = 'Copy', className = '' }: Props) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdown = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setCountdown(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      clearCountdown();
      setCountdown(CLEAR_AFTER_SECONDS);

      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearCountdown();
            // Clear clipboard after countdown
            void navigator.clipboard.writeText('').catch(() => null);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      /* clipboard access denied */
    }
  };

  // Clean up on unmount
  useEffect(() => () => clearCountdown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const isCopied = countdown !== null;

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={isCopied ? `Clipboard clears in ${countdown}s` : 'Copy to clipboard'}
      className={`text-xs px-2 py-0.5 rounded transition-colors ${
        isCopied
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
      } ${className}`}
    >
      {isCopied ? `✓ ${countdown}s` : label}
    </button>
  );
}
