'use client';

import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { AlertItem } from '@/types';
import { cn } from '@/lib/utils';

const SEVERITY_ICON = {
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR = {
  danger: 'text-danger border-danger/30',
  warning: 'text-warning border-warning/30',
  info: 'text-text-secondary border-border',
};

export function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null;

  return (
    <div className="panel p-3">
      <h3 className="text-sm font-semibold text-text mb-2 border-b border-primary pb-1">Alerts</h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {alerts.map((alert, i) => {
          const Icon = SEVERITY_ICON[alert.severity as keyof typeof SEVERITY_ICON] || Info;
          return (
            <div
              key={`${alert.alert_type}-${i}`}
              className={cn('flex gap-2 p-2 border text-xs', SEVERITY_COLOR[alert.severity as keyof typeof SEVERITY_COLOR])}
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-text">{alert.title}</div>
                <div className="text-text-secondary">{alert.message}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
