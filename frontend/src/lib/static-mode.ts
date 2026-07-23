/** Static / leadership deploy helpers (Vercel, no backend). */

export type SnapshotScopeId = 'all' | '7d' | 'mtd' | '30d' | 'month';

export interface SnapshotScopeMeta {
  date_from?: string | null;
  date_to?: string | null;
  label?: string;
  partner_count?: number;
  partners?: Record<string, string>;
}

export interface SnapshotManifest {
  published_at: string;
  version: number;
  scopes: Record<string, SnapshotScopeMeta>;
  partner_slugs?: Record<string, string>;
  shared?: string[];
}

export function isStaticDataMode(): boolean {
  return process.env.NEXT_PUBLIC_DATA_MODE === 'static';
}

/** Leadership chrome (hide upload, lead lists, etc.). Implied by static mode. */
export function isLeadershipMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_LEADERSHIP_MODE === 'true' || isStaticDataMode()
  );
}

const SNAPSHOT_BASE = '/data/snapshots';

let manifestPromise: Promise<SnapshotManifest | null> | null = null;

export async function getSnapshotManifest(): Promise<SnapshotManifest | null> {
  if (!isStaticDataMode()) return null;
  if (!manifestPromise) {
    manifestPromise = fetch(`${SNAPSHOT_BASE}/manifest.json`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as SnapshotManifest;
      })
      .catch(() => null);
  }
  return manifestPromise;
}

/** Clear cached manifest (e.g. after a new publish in same tab — rare). */
export function resetSnapshotManifestCache(): void {
  manifestPromise = null;
}

/**
 * Map active filters to a published scope id.
 * Prefers exact date match against the manifest (publish-time ranges).
 */
export function resolveSnapshotScope(
  filters: { date_from?: string; date_to?: string },
  manifest: SnapshotManifest | null
): SnapshotScopeId {
  const from = filters.date_from || undefined;
  const to = filters.date_to || undefined;
  if (!from && !to) return 'all';

  if (manifest?.scopes) {
    for (const id of ['7d', 'mtd', '30d', 'month'] as SnapshotScopeId[]) {
      const s = manifest.scopes[id];
      if (!s) continue;
      if ((s.date_from || undefined) === from && (s.date_to || undefined) === to) {
        return id;
      }
    }
  }

  // Fallback: match live preset ids even if dates drifted a day
  return 'all';
}

export function snapshotUrl(relPath: string): string {
  return `${SNAPSHOT_BASE}/${relPath.replace(/^\//, '')}`;
}

export async function fetchSnapshotJson<T>(relPath: string): Promise<T> {
  const res = await fetch(snapshotUrl(relPath));
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Snapshot missing: ${relPath}. Re-publish from local.`
        : `Snapshot failed (${res.status}): ${relPath}`
    );
  }
  return res.json() as Promise<T>;
}
