import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
  className?: string;
}

/**
 * One-click copy to clipboard. Shows "✓ Copied" for 2 seconds after copying.
 */
export function CopyButton({ value, label = 'Copy', className = '' }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard access denied — silently ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`text-xs px-2 py-0.5 rounded transition-colors ${
        copied
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
      } ${className}`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
