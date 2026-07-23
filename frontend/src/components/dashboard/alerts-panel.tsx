'use client';

import { AlertTriangle, Bell, Info, XCircle } from 'lucide-react';
import { AlertItem } from '@/types';
import { cn } from '@/lib/utils';

const SEVERITY_ICON = {
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR = {
  danger: 'text-danger border-danger/30 bg-danger/5',
  warning: 'text-warning border-warning/30 bg-warning/5',
  info: 'text-text-secondary border-border bg-surface/40',
};

const SEVERITY_ORDER: Record<string, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

export function AlertsPanel({
  alerts,
  className,
  maxHeightClass = 'max-h-[320px]',
}: {
  alerts: AlertItem[];
  className?: string;
  maxHeightClass?: string;
}) {
  const sorted = [...alerts].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  return (
    <div className={cn('panel p-3 h-full flex flex-col min-h-0', className)}>
      <div className="flex items-center gap-1.5 mb-2 border-b border-primary pb-1 shrink-0">
        <Bell className="w-3.5 h-3.5 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-text">Alerts</h3>
        {sorted.length > 0 && (
          <span className="ml-auto text-[10px] uppercase tracking-widest text-text-secondary kpi-value">
            {sorted.length}
          </span>
        )}
      </div>
      <div className={cn('space-y-2 overflow-y-auto flex-1 min-h-0', maxHeightClass)}>
        {!sorted.length ? (
          <p className="text-xs text-text-secondary py-2">
            No active alerts for the current scope.
          </p>
        ) : (
          sorted.map((alert, i) => {
            const Icon = SEVERITY_ICON[alert.severity as keyof typeof SEVERITY_ICON] || Info;
            return (
              <div
                key={`${alert.alert_type}-${i}`}
                className={cn(
                  'flex gap-2 p-2 border text-xs',
                  SEVERITY_COLOR[alert.severity as keyof typeof SEVERITY_COLOR]
                )}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium text-text">{alert.title}</div>
                  <div className="text-text-secondary">{alert.message}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
