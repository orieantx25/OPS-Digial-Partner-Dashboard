'use client';

import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InsightItem {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Compact Top-N “so what” findings above charts/tables. */
export function InsightStrip({
  title = 'Insights',
  items,
  className,
}: {
  title?: string;
  items: InsightItem[];
  className?: string;
}) {
  return (
    <div className={cn('panel p-3 h-full flex flex-col min-h-0', className)}>
      <div className="flex items-center gap-1.5 mb-2 shrink-0">
        <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      {!items.length ? (
        <p className="text-xs text-text-secondary">No standout findings for this scope yet.</p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto flex-1 min-h-0">
          {items.slice(0, 5).map((item) => (
            <li
              key={item.text}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-text leading-relaxed"
            >
              <span className="text-primary shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-primary self-start" />
              <span className="flex-1 min-w-0">{item.text}</span>
              {item.onAction && item.actionLabel && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline shrink-0"
                  onClick={item.onAction}
                >
                  {item.actionLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
