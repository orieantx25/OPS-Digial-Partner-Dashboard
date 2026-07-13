import { describe, it, expect } from 'vitest';
import { formatInteger, formatNumber, formatPercent, formatPct } from './utils';

describe('formatInteger', () => {
  it('formats full integers with grouping', () => {
    expect(formatInteger(563457)).toBe('5,63,457');
    expect(formatInteger(0)).toBe('0');
  });
});

describe('formatNumber', () => {
  it('formats full integers with Indian grouping', () => {
    expect(formatNumber(563457)).toBe('5,63,457');
    expect(formatNumber(1500)).toBe('1,500');
    expect(formatNumber(2_500_000)).toBe('25,00,000');
    expect(formatNumber(0)).toBe('0');
  });

  it('supports decimal places', () => {
    expect(formatNumber(12.345, 1)).toBe('12.3');
  });
});

describe('formatPct', () => {
  it('shows two decimal places', () => {
    expect(formatPct(12.3)).toBe('12.30%');
    expect(formatPct(0)).toBe('0.00%');
  });
});

describe('formatPercent', () => {
  it('shows positive trend', () => {
    expect(formatPercent(7.4)).toContain('▲');
    expect(formatPercent(7.4)).toContain('7.40%');
  });

  it('shows negative trend', () => {
    expect(formatPercent(-3.2)).toContain('▼');
    expect(formatPercent(-3.2)).toContain('3.20%');
  });
});
