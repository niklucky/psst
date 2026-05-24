import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Floating right-click context menu.
 * Renders at (x, y) and closes on outside click or Escape.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Keep menu inside viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: y,
    left: x,
  };

  return (
    <div
      ref={ref}
      style={style}
      className="min-w-[160px] bg-white rounded-lg shadow-lg border border-gray-200 py-1 text-sm"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors ${
            item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
          }`}
        >
          {item.icon && <span className="text-base">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}
