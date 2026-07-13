import { ValidationIssue } from '@/types';

/**
 * Prefer the accurate server-side rejection_summary (exact totals, cheap for huge
 * files); fall back to counting sampled issues for older responses.
 */
export function summarizeRejections(
  issues: ValidationIssue[],
  summary?: Record<string, number>
): { label: string; count: number }[] {
  if (summary && Object.keys(summary).length > 0) {
    return Object.entries(summary)
      .map(([key, count]) => ({ label: key.replace(/_/g, ' '), count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  const counts = new Map<string, number>();
  for (const issue of issues) {
    let key = issue.issue_type.replace(/_/g, ' ');
    if (issue.issue_type === 'missing_column' && issue.column) {
      key = `missing: ${issue.column}`;
    } else if (issue.column) {
      key = `${key} (${issue.column})`;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
