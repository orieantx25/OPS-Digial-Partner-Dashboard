'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Calculator,
  ChartArea,
  ChartColumn,
  ChartNoAxesCombined,
  Database,
  FileSpreadsheet,
  Gauge,
  Hash,
  Layers,
  LineChart,
  Percent,
  PieChart,
  Sigma,
  Table2,
  Target,
  TrendingUp,
} from 'lucide-react';

type IconNode = {
  Icon: LucideIcon;
  top: string;
  left: string;
  size: number;
  delay: string;
  variant: 'float' | 'float-alt';
  accent?: boolean;
};

/** Spread across full panel; positions avoid the top-left logo band. */
const ANALYTICS_ICONS: IconNode[] = [
  { Icon: BarChart3, top: '22%', left: '6%', size: 15, delay: '0s', variant: 'float', accent: true },
  { Icon: LineChart, top: '14%', left: '48%', size: 14, delay: '0.4s', variant: 'float-alt' },
  { Icon: PieChart, top: '12%', left: '78%', size: 13, delay: '0.8s', variant: 'float' },
  { Icon: TrendingUp, top: '28%', left: '22%', size: 14, delay: '1.1s', variant: 'float-alt', accent: true },
  { Icon: Activity, top: '24%', left: '62%', size: 14, delay: '0.2s', variant: 'float' },
  { Icon: ChartColumn, top: '18%', left: '88%', size: 13, delay: '1.4s', variant: 'float-alt' },
  { Icon: Gauge, top: '38%', left: '8%', size: 14, delay: '0.6s', variant: 'float' },
  { Icon: Table2, top: '42%', left: '38%', size: 14, delay: '1s', variant: 'float-alt', accent: true },
  { Icon: Calculator, top: '36%', left: '72%', size: 13, delay: '1.6s', variant: 'float' },
  { Icon: Target, top: '48%', left: '54%', size: 14, delay: '0.3s', variant: 'float-alt' },
  { Icon: Database, top: '52%', left: '18%', size: 12, delay: '1.8s', variant: 'float' },
  { Icon: FileSpreadsheet, top: '46%', left: '90%', size: 12, delay: '2s', variant: 'float-alt' },
  { Icon: Sigma, top: '58%', left: '32%', size: 13, delay: '0.9s', variant: 'float' },
  { Icon: Layers, top: '62%', left: '68%', size: 14, delay: '1.2s', variant: 'float-alt', accent: true },
  { Icon: ChartNoAxesCombined, top: '56%', left: '82%', size: 12, delay: '1.5s', variant: 'float' },
  { Icon: ChartArea, top: '68%', left: '10%', size: 13, delay: '0.5s', variant: 'float-alt' },
  { Icon: Percent, top: '72%', left: '44%', size: 13, delay: '1.3s', variant: 'float', accent: true },
  { Icon: Hash, top: '76%', left: '58%', size: 12, delay: '1.7s', variant: 'float-alt' },
  { Icon: BarChart3, top: '80%', left: '24%', size: 14, delay: '0.7s', variant: 'float' },
  { Icon: LineChart, top: '84%', left: '76%', size: 13, delay: '1.9s', variant: 'float-alt' },
  { Icon: PieChart, top: '88%', left: '48%', size: 12, delay: '2.1s', variant: 'float' },
  { Icon: Activity, top: '32%', left: '92%', size: 12, delay: '0.35s', variant: 'float-alt' },
  { Icon: TrendingUp, top: '64%', left: '4%', size: 13, delay: '1.05s', variant: 'float', accent: true },
  { Icon: Gauge, top: '70%', left: '92%', size: 13, delay: '1.55s', variant: 'float-alt' },
];

const REPORT_LINES = [
  'Digital Partner — Overview, funnel, partners, executive KPIs',
  'Digital Partner — Campus & block KPIs, refund cases, ROI',
  'Digital Partner — Block payment reconciliation, geographic & campaign views',
  'Campus Block Amount — Block bifurcation, refunds, gender splits',
  'Campus Block Amount — SSAHE & ADYPU campus-level KPIs',
  'Loan Operations — Pipeline, vendor tracking, risk cases',
  'Loan Operations — Campus bifurcation and loan required views',
];

function ReportsSlideBox() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % REPORT_LINES.length);
    }, 4500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full border border-[#3A3A3A] bg-[#141416]/95 rounded-sm backdrop-blur-sm">
      <div className="px-3 py-2 border-b border-[#3A3A3A]">
        <p className="text-[9px] uppercase tracking-[0.2em] text-primary font-semibold">
          Reports inside
        </p>
      </div>
      <div className="overflow-hidden px-3 py-4 min-h-[56px]">
        <div
          className="flex transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {REPORT_LINES.map((line, i) => (
            <p
              key={i}
              className="w-full shrink-0 text-[11px] text-[#B5B5B5] leading-relaxed pr-2"
            >
              <span className="text-primary mr-1.5">■</span>
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-1.5 pb-3">
        {REPORT_LINES.map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === index ? 'w-5 bg-primary' : 'w-1.5 bg-[#3A3A3A]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function AnalyticsIconBackdrop() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(58,58,58,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(58,58,58,0.45) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#0F0F10]/20 via-transparent to-[#0F0F10]/40" />

      {ANALYTICS_ICONS.map(({ Icon, top, left, size, delay, variant, accent }, i) => (
        <div
          key={i}
          className={`absolute flex h-8 w-8 items-center justify-center rounded-sm border border-[#3A3A3A]/80 bg-[#1A1A1A]/75 ${
            variant === 'float' ? 'analytics-float' : 'analytics-float-alt'
          }`}
          style={{
            top,
            left,
            animationDelay: delay,
          }}
        >
          <Icon
            className={accent ? 'text-primary' : 'text-[#9A9A9A]'}
            size={size}
            strokeWidth={1.75}
          />
        </div>
      ))}
    </div>
  );
}

export { AnalyticsIconBackdrop };

export function LoginInfoCarousel() {
  return (
    <div className="relative min-h-[420px] lg:min-h-screen bg-[#0F0F10] overflow-hidden">
      <AnalyticsIconBackdrop />

      <div className="relative z-10 p-6 lg:p-8">
        <Image
          src="/logo-dark.png"
          alt="upGrad School of Technology"
          width={160}
          height={56}
          priority
          className="h-auto w-[150px] object-contain"
        />
      </div>

      <div className="absolute inset-0 z-10 flex items-center justify-center px-6 lg:px-10 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md lg:max-w-lg">
          <ReportsSlideBox />
        </div>
      </div>
    </div>
  );
}
