# API Reference

Base URL: `http://localhost:8000/api/v1`

## Authentication

### POST `/auth/login`
```json
{ "username": "admin", "password": "admin123" }
```
Returns JWT token.

### GET `/auth/me`
Returns current user (requires Bearer token).

## Upload

### POST `/upload`
Multipart form with `files` field. Accepts multiple Excel/CSV/ZIP files.

Returns `UploadReport` with validation issues, duplicate IDs, row counts.

### GET `/upload/history`
Returns recent upload batches.

### GET `/upload/report/{batch_id}`
Returns full upload report for a batch.

## Analytics

All analytics endpoints accept universal filter query parameters:

| Parameter | Type |
|-----------|------|
| date_from, date_to | ISO date |
| week, month, quarter | string |
| year | integer |
| partner, state, city, persona | comma-separated |
| lead_stage, contact_stage, ai_status | comma-separated |
| campaign, source, medium, device | comma-separated |
| prospect_id, search | string |

### GET `/analytics/stats`
Dataset row count and availability.

### GET `/analytics/filters`
Distinct values for filter dropdowns.

### GET `/analytics/executive/kpis`
Executive KPI cards with trends.

### GET `/analytics/executive/charts`
All executive dashboard charts.

### GET `/analytics/funnel`
Funnel stage data with conversion/drop percentages.

### GET `/analytics/partner`
Partner comparison or detail (with `partner` param).

### GET `/analytics/contactability`
Contactability breakdown, trend, call distribution.

### GET `/analytics/ai-calling`
AI calling metrics.

### GET `/analytics/persona`
Persona analytics by partner.

### GET `/analytics/campaign`
Campaign ROI, CPA, applications.

### GET `/analytics/geographic`
State/city lead density.

### GET `/analytics/revenue`
Revenue, cost, profit, ROI, forecast.

### GET `/analytics/predictive`
Lead/admission/revenue forecasts.

### GET `/analytics/alerts`
Automatic alerts (contactability drop, partner down, etc.).

### GET `/analytics/search`
Paginated lead search (`page`, `page_size`).

### GET `/analytics/export`
Export filtered data as CSV or JSON (`format` param).

## Health

### GET `/health`
Service health check.
