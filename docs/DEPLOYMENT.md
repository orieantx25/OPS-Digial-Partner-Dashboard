# Deployment

## Docker Compose (Recommended)

```bash
docker compose up --build -d
```

Services:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000

Data persisted in `dp-data` Docker volume.

## Manual Production

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Frontend
```bash
cd frontend
npm install
npm run build
npm start
```

## Production Checklist

- [ ] Set strong `SECRET_KEY` in environment
- [ ] Change default user passwords
- [ ] Configure `CORS_ORIGINS` to production domain
- [ ] Use reverse proxy (nginx) with HTTPS
- [ ] Mount persistent volume for `data/` directory
- [ ] Set `LOG_LEVEL=WARNING` in production
- [ ] Configure backup for Parquet and SQLite files

## Scaling

- **Horizontal API scaling:** Run multiple uvicorn workers behind load balancer
- **Data scaling:** Parquet + DuckDB handles 20M+ rows on single node
- **Future:** Migrate metadata SQLite to PostgreSQL for multi-instance deployments
