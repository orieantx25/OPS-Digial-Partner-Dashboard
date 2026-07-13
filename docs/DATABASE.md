# Database

## Parquet — MASTER_DATASET

**Path:** `data/parquet/master_dataset.parquet`

Canonical column schema defined in `backend/app/domain/schema.py`.

### Required Columns
- prospect_id, name, email, contact_stage, lead_stage, partner, state, date

### Derived Columns (auto-generated)
- contactability, dial_bucket, week, month, quarter, year
- lead_age_days, partner_share, conversion_pct, ai_contacted
- funnel_stage, roi, ingested_at, source_file, source_batch_id

## SQLite — Metadata

**Path:** `data/metadata.db`

### Tables

#### upload_batches
Tracks every import with full JSON report.

#### users
RBAC users with hashed passwords.

#### analytics_cache
Optional persistent cache entries.

#### snapshots
Historical dataset snapshots for point-in-time analysis.

## DuckDB — Analytics

**Path:** `data/analytics.duckdb`

### Views
- `master_dataset` — reads from Parquet file

### Materialized Tables
- `mv_kpi_daily` — daily aggregated KPIs
- `mv_partner_summary` — per-partner rollups

Refreshed after each successful upload.
