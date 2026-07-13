# Folder Structure

```
DP Dash/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── dependencies.py      # DI, auth, filter parsing
│   │   │   └── routes/
│   │   │       ├── auth.py
│   │   │       ├── upload.py
│   │   │       └── analytics.py
│   │   ├── domain/
│   │   │   ├── models.py            # Pydantic DTOs
│   │   │   └── schema.py            # Column definitions
│   │   ├── infrastructure/
│   │   │   ├── database.py          # SQLite metadata
│   │   │   └── duckdb_repo.py       # DuckDB + cache
│   │   ├── services/
│   │   │   ├── ingestion_service.py # Upload pipeline
│   │   │   ├── analytics_service.py # SQL analytics
│   │   │   └── auth_service.py      # JWT + RBAC
│   │   ├── config.py
│   │   ├── logging_config.py
│   │   └── main.py
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                     # Next.js pages (10 dashboards + upload)
│   │   ├── components/
│   │   │   ├── charts/
│   │   │   ├── dashboard/
│   │   │   ├── layout/
│   │   │   ├── tables/
│   │   │   └── upload/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── store/
│   │   └── types/
│   ├── package.json
│   └── Dockerfile
├── docs/
├── scripts/
│   └── generate_sample_data.py
├── docker-compose.yml
└── README.md
```
