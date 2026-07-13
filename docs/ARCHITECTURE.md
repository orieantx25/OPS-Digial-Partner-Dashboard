# Architecture

## Overview

The DP Analytics Platform implements a **Unified Data Engine** where multiple workbooks are treated as logical partitions of a single MASTER_DATASET.

```
Workbook A + Workbook B + Workbook C → MASTER_DATASET → Analytics Engine → Dashboard
```

## Layers

### 1. Upload Engine (`backend/app/services/ingestion_service.py`)
- Accepts Excel (.xlsx, .xls), CSV, ZIP archives
- Validates required columns, data types, dates, duplicate Prospect IDs
- Normalizes partner names, states, contact stages, phone numbers
- Generates derived columns (contactability, dial bucket, funnel stage, ROI)
- Incrementally appends to Parquet without rebuilding existing data

### 2. Storage Layer
- **Parquet** (`data/parquet/master_dataset.parquet`) — columnar analytical storage
- **SQLite** (`data/metadata.db`) — upload batches, users, cache metadata
- **DuckDB** (`data/analytics.duckdb`) — SQL query engine with materialized views

### 3. Analytics Engine (`backend/app/services/analytics_service.py`)
- SQL-based aggregations on MASTER_DATASET
- Materialized views for daily KPIs and partner summaries
- In-memory cache with configurable TTL
- Filter composition for universal dashboard filters

### 4. API Layer (`backend/app/api/`)
- FastAPI REST endpoints
- JWT authentication with RBAC
- Request validation via Pydantic
- Structured JSON logging

### 5. Frontend (`frontend/src/`)
- Next.js App Router with client-side data fetching
- Universal filter bar on all pages
- ECharts for interactive visualizations
- TanStack Table with virtual scrolling
- Zustand for filter/drill-down state

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Parquet + DuckDB | Handles 20M+ rows with columnar compression and SQL analytics |
| Incremental append | Future uploads don't require full rebuild |
| Prospect ID dedup | Prevents duplicate rows across workbooks |
| Polars for ETL | Fast DataFrame operations during ingestion |
| TanStack Table over AG Grid Enterprise | No license dependency; full virtual scroll support |

## Data Flow

1. User uploads files via drag-and-drop
2. Files are validated and normalized
3. Valid rows appended to Parquet MASTER_DATASET
4. DuckDB materialized views refreshed
5. Analytics cache invalidated
6. Dashboards auto-refresh via API calls
