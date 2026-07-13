# Digital Partner Analytics

Enterprise analytics platform for upGrad School of Technology. Replaces spreadsheet dashboards with a scalable web application that merges unlimited Excel/CSV workbooks into a single **MASTER_DATASET**.

## Architecture

```
Excel/CSV Workbooks → Upload Engine → Validation → Cleaning → Parquet Store → DuckDB → REST API → Next.js Dashboard
```

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React, TypeScript, TailwindCSS, ECharts, TanStack Table |
| Backend | Python FastAPI |
| Analytics | DuckDB (SQL aggregations, materialized views) |
| Processing | Polars, PyArrow |
| Storage | Parquet (MASTER_DATASET), SQLite (metadata) |
| Auth | JWT + RBAC |

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 20+

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000

### Generate Sample Data

```bash
cd backend
pip install xlsxwriter  # if using write_excel via polars
python ../scripts/generate_sample_data.py --rows 500
```

Upload files from `sample-data/` via **Upload Data**.

### Docker

```bash
docker compose up --build
```

## Default Users

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Admin |
| ops | ops123 | Operations |
| mgmt | mgmt123 | Management |
| partner | partner123 | Partner (scoped) |
| viewer | viewer123 | Read Only |

## Dashboard Pages

1. Executive Dashboard
2. Lead Funnel
3. Partner Analytics
4. Contactability Analytics
5. AI Calling Dashboard
6. Persona Analytics
7. Campaign Analytics
8. Geographic Analytics
9. Revenue Dashboard
10. Predictive Analytics

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Database](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Environment Variables](docs/ENVIRONMENT.md)
- [Folder Structure](docs/FOLDER_STRUCTURE.md)

## Tests

```bash
cd backend && pytest
cd frontend && npm test
```
