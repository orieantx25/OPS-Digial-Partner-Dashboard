# Environment Variables

## Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| APP_NAME | DP Analytics Platform | Application name |
| APP_ENV | development | Environment (development/production) |
| DEBUG | true | Debug mode |
| SECRET_KEY | change-me | JWT signing key |
| API_PREFIX | /api/v1 | API route prefix |
| DATA_DIR | ./data | Root data directory |
| PARQUET_DIR | ./data/parquet | Parquet storage path |
| METADATA_DB_URL | sqlite:///./data/metadata.db | SQLAlchemy database URL |
| DUCKDB_PATH | ./data/analytics.duckdb | DuckDB file path |
| MAX_UPLOAD_SIZE_MB | 5120 | Max upload size (5 GB) |
| MAX_FILES_PER_BATCH | 100 | Max files per upload |
| ALLOWED_EXTENSIONS | .xlsx,.xls,.csv,.zip | Allowed file types |
| JWT_ALGORITHM | HS256 | JWT algorithm |
| JWT_EXPIRE_MINUTES | 480 | Token expiry |
| CORS_ORIGINS | http://localhost:3000 | Allowed CORS origins |
| ANALYTICS_CACHE_TTL_SECONDS | 300 | Analytics cache TTL |
| LOG_LEVEL | INFO | Logging level |

## Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| NEXT_PUBLIC_API_URL | http://localhost:8000 | Backend API URL |
