"""SQL-based analytics engine operating on MASTER_DATASET."""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.domain.models import AlertItem, ChartData, ChartSeries, FilterParams, KpiMetric, PaginatedResponse
from app.domain.schema import (
    BLOCK_PAYMENT_TABLE,
    FUNNEL_STAGES,
    MASTER_DATASET_TABLE,
    PARTNER_CANONICAL,
    PARTNER_COMMERCIALS,
    PERSONA_ACTIVITY_TABLE,
    canonical_partner,
)
from app.infrastructure.duckdb_repo import AnalyticsCache, DuckDBRepository
from app.logging_config import get_logger
from app.services.empty_defaults import (
    empty_ai_calling,
    empty_alerts,
    empty_chart,
    empty_executive_charts,
    empty_funnel,
    empty_kpis,
    empty_predictive,
    empty_revenue,
    empty_search,
)

logger = get_logger(__name__)

# Dial counts above this are treated as corrupt (e.g. Excel date serials like 1899).
MAX_DIAL_COUNT = 100
SAFE_DIALS_EXPR = (
    f"CASE WHEN COALESCE(CAST(total_dialed_count AS INTEGER), 0) > {MAX_DIAL_COUNT} "
    f"THEN 0 ELSE LEAST(GREATEST(COALESCE(CAST(total_dialed_count AS INTEGER), 0), 0), "
    f"{MAX_DIAL_COUNT}) END"
)
# Executive KPI + contactability bucket — Col J Last Activity = Lead Capture.
LEADS_NOT_TOUCHED_EXPR = "LOWER(TRIM(COALESCE(last_activity, ''))) = 'lead capture'"
LEADS_NOT_TOUCHED_LABEL = "Leads not Touched"


class AnalyticsEngine:
    """Unified analytics layer with SQL aggregations and caching."""

    def __init__(
        self,
        duck_repo: Optional[DuckDBRepository] = None,
        cache: Optional[AnalyticsCache] = None,
    ):
        self.duck_repo = duck_repo or DuckDBRepository()
        self.cache = cache or AnalyticsCache()

    def _filter_payload(self, filters: FilterParams) -> Dict[str, Any]:
        return filters.model_dump(exclude_none=True)

    def _has_data(self) -> bool:
        if not self.duck_repo.master_exists():
            return False
        return self.duck_repo.get_row_count() > 0

    def get_dataset_stats(self) -> Dict[str, Any]:
        cached = self.cache.get("dataset_stats", {})
        if cached is not None:
            return cached
        if not self.duck_repo.master_exists():
            result = {"total_rows": 0, "has_data": False}
            self.cache.set("dataset_stats", {}, result)
            return result
        # Count only the five digital partners so the UI record total matches charts.
        placeholders = ", ".join(["?"] * len(PARTNER_CANONICAL))
        rows = self.duck_repo.query_dicts(
            f"SELECT COUNT(*) AS n FROM {MASTER_DATASET_TABLE} "
            f"WHERE partner IN ({placeholders})",
            list(PARTNER_CANONICAL),
        )
        total = int(rows[0]["n"]) if rows else 0
        result = {
            "total_rows": total,
            "has_data": total > 0 or self.duck_repo.master_exists(),
        }
        self.cache.set("dataset_stats", {}, result)
        return result

    def get_filter_options(self) -> Dict[str, List[str]]:
        cached = self.cache.get("filter_options", {})
        if cached is not None:
            return cached
        if not self.duck_repo.master_exists():
            result = {
                "partners": list(PARTNER_CANONICAL),
                "states": [], "cities": [], "personas": [],
                "lead_stages": [], "contact_stages": [], "ai_statuses": [],
                "campaigns": [], "sources": [], "mediums": [], "devices": [],
                "months": [], "years": [],
            }
            self.cache.set("filter_options", {}, result)
            return result
        options: Dict[str, List[str]] = {}
        for field, col in [
            ("partners", "partner"), ("states", "state"), ("cities", "city"),
            ("personas", "persona"), ("lead_stages", "lead_stage"),
            ("contact_stages", "contact_stage"), ("ai_statuses", "ai_status"),
            ("campaigns", "campaign"), ("sources", "source"), ("mediums", "medium"),
            ("devices", "device"), ("months", "month"),
        ]:
            rows = self.duck_repo.query_dicts(
                f"SELECT DISTINCT {col} AS val FROM {MASTER_DATASET_TABLE} "
                f"WHERE {col} IS NOT NULL ORDER BY val"
            )
            options[field] = [r["val"] for r in rows if r["val"]]

        # Partner dropdown: only the five digital partners (never Unknown).
        options["partners"] = list(PARTNER_CANONICAL)

        year_rows = self.duck_repo.query_dicts(
            f"SELECT DISTINCT year AS val FROM {MASTER_DATASET_TABLE} "
            f"WHERE year IS NOT NULL ORDER BY val"
        )
        options["years"] = [str(r["val"]) for r in year_rows]
        self.cache.set("filter_options", {}, options)
        return options
    @staticmethod
    def _ai_contacted_condition(available: set) -> str:
        """SQL predicate: lead was touched by the AI bot (Col D or stored flags)."""
        parts: List[str] = []
        if "ai_contacted" in available:
            parts.append("ai_contacted")
        if "contact_stage" in available:
            parts.append("LOWER(COALESCE(contact_stage, '')) LIKE '%ai bot%'")
        if "ai_status" in available:
            parts.append("(ai_status IS NOT NULL AND ai_status <> '')")
        if not parts:
            return "FALSE"
        return "(" + " OR ".join(parts) + ")"

    @staticmethod
    def _ai_sum(available: set, bool_col: str, stage_patterns: List[str]) -> str:
        """SQL SUM for an AI outcome, using boolean column and/or contact stage text."""
        conds: List[str] = []
        if bool_col in available:
            conds.append(bool_col)
        if "contact_stage" in available:
            for pat in stage_patterns:
                conds.append(f"LOWER(COALESCE(contact_stage, '')) LIKE '%{pat.lower()}%'")
        if not conds:
            return "0"
        return f"SUM(CASE WHEN {' OR '.join(conds)} THEN 1 ELSE 0 END)"

    def _ai_match_condition(self, available: set, bool_col: str, stage_patterns: List[str]) -> str:
        """SQL predicate for a single lead matching an AI outcome."""
        conds: List[str] = []
        if bool_col in available:
            conds.append(bool_col)
        if "contact_stage" in available:
            for pat in stage_patterns:
                conds.append(f"LOWER(COALESCE(contact_stage, '')) LIKE '%{pat.lower()}%'")
        if not conds:
            return "FALSE"
        return "(" + " OR ".join(conds) + ")"

    def _lead_capture_condition(self, available: set) -> str:
        """True when the lead is still tagged Lead Capture on stage or activity."""
        parts: List[str] = []
        if "lead_stage" in available:
            parts.append("LOWER(TRIM(COALESCE(lead_stage, ''))) = 'lead capture'")
        if "contact_stage" in available:
            parts.append("LOWER(TRIM(COALESCE(contact_stage, ''))) = 'lead capture'")
        if "last_activity" in available:
            parts.append("LOWER(TRIM(COALESCE(last_activity, ''))) = 'lead capture'")
        if not parts:
            return "FALSE"
        return "(" + " OR ".join(parts) + ")"

    def _ai_connected_condition(self, available: set) -> str:
        """Connected via AI bot calling (Connected ∩ AI stages)."""
        ai = self._ai_contacted_condition(available)
        return f"(connected AND {ai})"

    def _ac_connected_condition(self, available: set) -> str:
        """AC Connected: connected leads that are not on AI stages or Lead Capture."""
        ai = self._ai_contacted_condition(available)
        lead_capture = self._lead_capture_condition(available)
        return f"(connected AND NOT ({ai}) AND NOT ({lead_capture}))"

    def _lead_filter_clause(self, lead_filter: str, prefix: str = "") -> Optional[str]:
        """Map explorer filter keys to SQL predicates aligned with KPI/bucket logic."""
        available = set(self.duck_repo.get_master_columns())
        ai = self._ai_contacted_condition(available)
        leads_not_touched = (
            LEADS_NOT_TOUCHED_EXPR if "last_activity" in available else "FALSE"
        )
        p = prefix

        bool_filters = {
            "connected": f"{p}connected",
            "ai_connected": self._ai_connected_condition(available),
            "ac_connected": self._ac_connected_condition(available),
            "mql": f"{p}mql",
            "sql": f"{p}sql",
            "applications": f"{p}application",
            "test_registrations": f"{p}test_registration",
            "offer_letters": f"{p}offer_letter",
            "interview": f"{p}interview" if "interview" in available else "FALSE",
            "block_amount_paid": f"{p}block_amount_paid",
            "admissions": f"{p}admission",
            "never_dialed": f"({leads_not_touched})",
            "avg_dial_count": f"({SAFE_DIALS_EXPR} > 0)",
            "ai_calls": f"({ai})",
            "dnp_pct": f"{p}dnp",
            "bucket_ai_bot_dialed": f"({ai})",
            "bucket_leads_not_touched": f"(NOT ({ai}) AND {leads_not_touched})",
            "bucket_1_dial": (
                f"(NOT ({ai}) AND NOT ({leads_not_touched}) AND {SAFE_DIALS_EXPR} = 1)"
            ),
            "bucket_2_dial": (
                f"(NOT ({ai}) AND NOT ({leads_not_touched}) AND {SAFE_DIALS_EXPR} = 2)"
            ),
            "bucket_3_plus_dial": (
                f"(NOT ({ai}) AND NOT ({leads_not_touched}) AND {SAFE_DIALS_EXPR} >= 3)"
            ),
        }
        if lead_filter in bool_filters:
            return bool_filters[lead_filter]

        ai_filters = {
            "ai_qualified": self._ai_match_condition(
                available,
                "ai_qualified",
                ["ai bot qualified - warm", "ai bot qualified - hot", "ai bot qualified - high intent"],
            ),
            "ai_warm": self._ai_match_condition(
                available, "ai_warm", ["ai bot qualified - warm"]
            ),
            "ai_high_intent": self._ai_match_condition(
                available, "ai_high_intent", ["ai bot qualified - high intent"]
            ),
            "ai_payment_link": self._ai_match_condition(
                available, "ai_payment_link", ["ai bot sent - payment link"]
            ),
            "ai_brochure": self._ai_match_condition(
                available, "ai_brochure", ["ai bot sent - brochure"]
            ),
            "ai_dnp": self._ai_match_condition(
                available, "dnp", ["ai bot reached - dnp"]
            ),
            "ai_interested": self._ai_match_condition(
                available,
                "ai_interested",
                ["ai bot qualified - hot", "ai bot qualified - high intent"],
            ),
            "ai_callback": self._ai_match_condition(
                available, "ai_callback", ["ai bot reached - cb later"]
            ),
        }
        return ai_filters.get(lead_filter)

    def _build_where(self, filters: FilterParams, table_alias: str = "") -> Tuple[str, List[Any]]:
        prefix = f"{table_alias}." if table_alias else ""
        clauses: List[str] = []
        params: List[Any] = []

        if filters.date_from:
            clauses.append(f"CAST({prefix}date AS DATE) >= CAST(? AS DATE)")
            params.append(str(filters.date_from)[:10])
        if filters.date_to:
            clauses.append(f"CAST({prefix}date AS DATE) <= CAST(? AS DATE)")
            params.append(str(filters.date_to)[:10])
        if filters.week:
            clauses.append(f"{prefix}week = ?")
            params.append(filters.week)
        if filters.month:
            clauses.append(f"{prefix}month = ?")
            params.append(filters.month)
        if filters.quarter:
            clauses.append(f"{prefix}quarter = ?")
            params.append(filters.quarter)
        if filters.year:
            clauses.append(f"{prefix}year = ?")
            params.append(filters.year)
        if filters.partner:
            allowed = [
                p for p in filters.partner
                if canonical_partner(p) in PARTNER_CANONICAL
                or p in PARTNER_CANONICAL
            ]
            # Intersect UI selection with the five digital partners only.
            partners = allowed or list(PARTNER_CANONICAL)
            placeholders = ", ".join(["?"] * len(partners))
            clauses.append(f"{prefix}partner IN ({placeholders})")
            params.extend(partners)
        else:
            # Dashboard scope: always limit to the five digital partners.
            placeholders = ", ".join(["?"] * len(PARTNER_CANONICAL))
            clauses.append(f"{prefix}partner IN ({placeholders})")
            params.extend(list(PARTNER_CANONICAL))
        if filters.state:
            placeholders = ", ".join(["?"] * len(filters.state))
            clauses.append(f"{prefix}state IN ({placeholders})")
            params.extend(filters.state)
        if filters.city:
            placeholders = ", ".join(["?"] * len(filters.city))
            clauses.append(f"{prefix}city IN ({placeholders})")
            params.extend(filters.city)
        if filters.persona:
            placeholders = ", ".join(["?"] * len(filters.persona))
            clauses.append(f"{prefix}persona IN ({placeholders})")
            params.extend(filters.persona)
        if filters.lead_stage:
            placeholders = ", ".join(["?"] * len(filters.lead_stage))
            clauses.append(f"{prefix}lead_stage IN ({placeholders})")
            params.extend(filters.lead_stage)
        if filters.contact_stage:
            placeholders = ", ".join(["?"] * len(filters.contact_stage))
            clauses.append(f"{prefix}contact_stage IN ({placeholders})")
            params.extend(filters.contact_stage)
        if filters.ai_status:
            placeholders = ", ".join(["?"] * len(filters.ai_status))
            clauses.append(f"{prefix}ai_status IN ({placeholders})")
            params.extend(filters.ai_status)
        if filters.campaign:
            placeholders = ", ".join(["?"] * len(filters.campaign))
            clauses.append(f"{prefix}campaign IN ({placeholders})")
            params.extend(filters.campaign)
        if filters.source:
            placeholders = ", ".join(["?"] * len(filters.source))
            clauses.append(f"{prefix}source IN ({placeholders})")
            params.extend(filters.source)
        if filters.medium:
            placeholders = ", ".join(["?"] * len(filters.medium))
            clauses.append(f"{prefix}medium IN ({placeholders})")
            params.extend(filters.medium)
        if filters.device:
            placeholders = ", ".join(["?"] * len(filters.device))
            clauses.append(f"{prefix}device IN ({placeholders})")
            params.extend(filters.device)
        if filters.prospect_id:
            clauses.append(f"{prefix}prospect_id = ?")
            params.append(filters.prospect_id)
        if filters.search:
            clauses.append(
                f"({prefix}prospect_id ILIKE ? OR {prefix}name ILIKE ? OR "
                f"{prefix}phone ILIKE ? OR {prefix}email ILIKE ? OR "
                f"{prefix}partner ILIKE ? OR {prefix}state ILIKE ? OR "
                f"{prefix}city ILIKE ?)"
            )
            term = f"%{filters.search}%"
            params.extend([term] * 7)
        if filters.lead_filter:
            clause = self._lead_filter_clause(filters.lead_filter, prefix)
            if clause:
                clauses.append(clause)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return where, params

    def get_executive_kpis(self, filters: FilterParams) -> List[KpiMetric]:
        if not self._has_data():
            return empty_kpis()

        cached = self.cache.get("executive_kpis", self._filter_payload(filters))
        if cached:
            return cached

        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        ai_calls = self._ai_sum(available, "ai_contacted", ["ai bot"])
        ai_connected = self._ai_connected_condition(available)
        ac_connected = self._ac_connected_condition(available)
        leads_not_touched = (
            LEADS_NOT_TOUCHED_EXPR
            if "last_activity" in available
            else "FALSE"
        )
        base_sql = f"""
            SELECT
                COUNT(*) AS total_leads,
                SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected,
                SUM(CASE WHEN {ai_connected} THEN 1 ELSE 0 END) AS ai_connected,
                SUM(CASE WHEN {ac_connected} THEN 1 ELSE 0 END) AS ac_connected,
                SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS contactability,
                SUM(CASE WHEN {leads_not_touched} THEN 1 ELSE 0 END) AS never_dialed,
                SUM(CASE WHEN mql THEN 1 ELSE 0 END) AS mql,
                SUM(CASE WHEN sql THEN 1 ELSE 0 END) AS sql,
                SUM(CASE WHEN application THEN 1 ELSE 0 END) AS applications,
                SUM(CASE WHEN test_registration THEN 1 ELSE 0 END) AS test_registrations,
                SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letters,
                SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid,
                SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                COALESCE(SUM(revenue), 0) AS revenue,
                COALESCE(SUM(partner_cost), 0) AS partner_cost,
                {ai_calls} AS ai_calls,
                COALESCE(AVG(total_dialed_count), 0) AS avg_dial_count,
                SUM(CASE WHEN dnp THEN 1 ELSE 0 END) AS dnp_count
            FROM {MASTER_DATASET_TABLE}
            {where}
        """
        current = self.duck_repo.query_dicts(base_sql, params)
        cur = current[0] if current else {}

        prev_filters = self._previous_period_filters(filters)
        prev_where, prev_params = self._build_where(prev_filters)
        prev_sql = base_sql.replace(where, prev_where) if where else base_sql.replace(
            f"FROM {MASTER_DATASET_TABLE}", f"FROM {MASTER_DATASET_TABLE} {prev_where}"
        )
        if not where and prev_where:
            prev_sql = base_sql.replace(
                f"FROM {MASTER_DATASET_TABLE}",
                f"FROM {MASTER_DATASET_TABLE} {prev_where}",
            )
        else:
            prev_sql = f"""
                SELECT
                    COUNT(*) AS total_leads,
                    SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected,
                    SUM(CASE WHEN {ai_connected} THEN 1 ELSE 0 END) AS ai_connected,
                    SUM(CASE WHEN {ac_connected} THEN 1 ELSE 0 END) AS ac_connected,
                    SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS contactability,
                    SUM(CASE WHEN {leads_not_touched} THEN 1 ELSE 0 END) AS never_dialed,
                    SUM(CASE WHEN mql THEN 1 ELSE 0 END) AS mql,
                    SUM(CASE WHEN sql THEN 1 ELSE 0 END) AS sql,
                    SUM(CASE WHEN application THEN 1 ELSE 0 END) AS applications,
                    SUM(CASE WHEN test_registration THEN 1 ELSE 0 END) AS test_registrations,
                    SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letters,
                    SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid,
                    SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                    COALESCE(SUM(revenue), 0) AS revenue,
                    COALESCE(SUM(partner_cost), 0) AS partner_cost,
                    {ai_calls} AS ai_calls,
                    COALESCE(AVG(total_dialed_count), 0) AS avg_dial_count,
                    SUM(CASE WHEN dnp THEN 1 ELSE 0 END) AS dnp_count
                FROM {MASTER_DATASET_TABLE}
                {prev_where}
            """
        previous = self.duck_repo.query_dicts(prev_sql, prev_params)
        prev = previous[0] if previous else {}

        total = float(cur.get("total_leads") or 0)
        dnp = float(cur.get("dnp_count") or 0)
        dnp_pct = (dnp / total * 100) if total > 0 else 0
        revenue = float(cur.get("revenue") or 0)
        cost = float(cur.get("partner_cost") or 0)
        roi = ((revenue - cost) / cost * 100) if cost > 0 else 0

        prev_total = float(prev.get("total_leads") or 0)
        prev_dnp = float(prev.get("dnp_count") or 0)
        prev_dnp_pct = (prev_dnp / prev_total * 100) if prev_total > 0 else 0
        prev_revenue = float(prev.get("revenue") or 0)
        prev_cost = float(prev.get("partner_cost") or 0)
        prev_roi = ((prev_revenue - prev_cost) / prev_cost * 100) if prev_cost > 0 else 0

        trend_rows = self.duck_repo.query_dicts(
            f"""
            SELECT CAST(date AS DATE) AS dt, COUNT(*) AS cnt
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY CAST(date AS DATE)
            ORDER BY dt
            LIMIT 30
            """,
            params,
        )
        trend_data = [float(r["cnt"]) for r in trend_rows]

        kpi_defs = [
            ("total_leads", "Total Leads", float(cur.get("total_leads") or 0), float(prev.get("total_leads") or 0)),
            ("connected", "Connected", float(cur.get("connected") or 0), float(prev.get("connected") or 0)),
            ("ai_connected", "AI Connected", float(cur.get("ai_connected") or 0), float(prev.get("ai_connected") or 0)),
            ("ac_connected", "AC Connected", float(cur.get("ac_connected") or 0), float(prev.get("ac_connected") or 0)),
            ("contactability", "Contactability", float(cur.get("contactability") or 0), float(prev.get("contactability") or 0)),
            ("never_dialed", "Leads not Touched", float(cur.get("never_dialed") or 0), float(prev.get("never_dialed") or 0)),
            ("mql", "MQL", float(cur.get("mql") or 0), float(prev.get("mql") or 0)),
            ("sql", "SQL", float(cur.get("sql") or 0), float(prev.get("sql") or 0)),
            ("applications", "Applications", float(cur.get("applications") or 0), float(prev.get("applications") or 0)),
            ("test_registrations", "Registrations", float(cur.get("test_registrations") or 0), float(prev.get("test_registrations") or 0)),
            ("offer_letters", "Offer Letters", float(cur.get("offer_letters") or 0), float(prev.get("offer_letters") or 0)),
            ("block_amount_paid", "Block Amount Paid", float(cur.get("block_amount_paid") or 0), float(prev.get("block_amount_paid") or 0)),
            ("admissions", "Admissions", float(cur.get("admissions") or 0), float(prev.get("admissions") or 0)),
            ("revenue", "Revenue", revenue, prev_revenue),
            ("roi", "ROI %", roi, prev_roi),
            ("ai_calls", "AI Calls", float(cur.get("ai_calls") or 0), float(prev.get("ai_calls") or 0)),
            ("avg_dial_count", "Avg Dial Count", float(cur.get("avg_dial_count") or 0), float(prev.get("avg_dial_count") or 0)),
            ("dnp_pct", "DNP %", dnp_pct, prev_dnp_pct),
        ]

        result = []
        for key, label, current_val, previous_val in kpi_defs:
            change = ((current_val - previous_val) / previous_val * 100) if previous_val else 0
            result.append(
                KpiMetric(
                    key=key,
                    label=label,
                    current=round(current_val, 2),
                    previous=round(previous_val, 2),
                    change_pct=round(change, 2),
                    trend=trend_data,
                )
            )

        self.cache.set("executive_kpis", self._filter_payload(filters), result)
        logger.info("analytics_refresh", dashboard="executive", kpi_count=len(result))
        return result

    def get_executive_charts(self, filters: FilterParams) -> Dict[str, ChartData]:
        if not self._has_data():
            return empty_executive_charts()
        cached = self.cache.get("executive_charts", self._filter_payload(filters))
        if cached:
            return cached
        result = {
            "daily_leads": self.get_time_series_chart(filters, "daily"),
            "weekly_leads": self.get_time_series_chart(filters, "weekly"),
            "monthly_leads": self.get_time_series_chart(filters, "monthly"),
            "partner_comparison": self.get_partner_comparison(filters),
            "lead_sources": self.get_lead_sources(filters),
            "state_distribution": self.get_state_distribution(filters),
            "call_distribution": self.get_call_distribution(filters),
            "funnel": self.get_funnel_data(filters),
            "heatmap": self.get_heatmap_data(filters),
            "contactability_trend": self.get_contactability_trend(filters),
            **self.get_metric_trends(filters),
        }
        self.cache.set("executive_charts", self._filter_payload(filters), result)
        return result

    def get_contactability_dashboard(self, filters: FilterParams) -> Dict[str, ChartData]:
        if not self._has_data():
            charts = empty_executive_charts()
            return {
                "breakdown": empty_chart("contactability", "donut", "Contactability Breakdown"),
                "trend": charts["contactability_trend"],
                "call_distribution": charts["call_distribution"],
            }
        return {
            "breakdown": self.get_contactability_breakdown(filters),
            "trend": self.get_contactability_trend(filters),
            "call_distribution": self.get_call_distribution(filters),
        }

    def _previous_period_filters(self, filters: FilterParams) -> FilterParams:
        data = filters.model_dump()
        if filters.date_from and filters.date_to:
            try:
                start = datetime.fromisoformat(str(filters.date_from)[:10])
                end = datetime.fromisoformat(str(filters.date_to)[:10])
                delta = end - start
                data["date_from"] = (start - delta - timedelta(days=1)).strftime("%Y-%m-%d")
                data["date_to"] = (start - timedelta(days=1)).strftime("%Y-%m-%d")
            except ValueError:
                pass
        return FilterParams(**{k: v for k, v in data.items() if v is not None})

    def get_time_series_chart(
        self, filters: FilterParams, granularity: str = "daily"
    ) -> ChartData:
        where, params = self._build_where(filters)
        if granularity == "weekly":
            group_col = "week"
        elif granularity == "monthly":
            group_col = "month"
        else:
            group_col = "CAST(date AS DATE)"

        available = set(self.duck_repo.get_master_columns())
        test_expr = (
            "SUM(CASE WHEN test_registration THEN 1 ELSE 0 END)"
            if "test_registration" in available
            else "0"
        )
        block_expr = (
            "SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END)"
            if "block_amount_paid" in available
            else "0"
        )
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT {group_col} AS period,
                   COUNT(*) AS leads,
                   {test_expr} AS test_takers,
                   {block_expr} AS block_amount
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY {group_col}
            ORDER BY period
            """,
            params,
        )
        return ChartData(
            chart_id=f"leads_{granularity}",
            chart_type="line",
            title=f"{granularity.title()} Leads",
            categories=[str(r["period"]) for r in rows],
            series=[
                ChartSeries(name="Leads", data=[int(r["leads"]) for r in rows]),
                ChartSeries(name="Test Takers", data=[int(r["test_takers"] or 0) for r in rows]),
                ChartSeries(name="Block Amount Paid", data=[int(r["block_amount"] or 0) for r in rows]),
            ],
        )

    def get_partner_comparison(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())

        def flag_sum(col: str) -> str:
            # Guard legacy datasets that may predate a flag column.
            if col in available:
                return f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END)"
            return "0"

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT partner, COUNT(*) AS leads,
                   {flag_sum("admission")} AS admissions,
                   {flag_sum("offer_letter")} AS offer_letters,
                   {flag_sum("block_amount_paid")} AS block_amount
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} partner IS NOT NULL
            GROUP BY partner
            ORDER BY leads DESC
            LIMIT 20
            """,
            params,
        )

        clash_map = {
            str(item["partner"]): int(item["count"])
            for item in self._counsellor_clash_counts_by_partner(filters)
        }
        block_amounts = [int(r["block_amount"] or 0) for r in rows]
        clash_counts = [
            min(clash_map.get(str(r["partner"]), 0), block_amounts[i])
            for i, r in enumerate(rows)
        ]
        # Stack clean block amount + clashes so bar height = total block paid.
        clean_blocks = [
            max(0, block_amounts[i] - clash_counts[i]) for i in range(len(rows))
        ]

        return ChartData(
            chart_id="partner_comparison",
            chart_type="bar",
            title="Partner Comparison",
            categories=[r["partner"] for r in rows],
            series=[
                ChartSeries(name="Leads", data=[int(r["leads"]) for r in rows]),
                ChartSeries(name="Offer Letter", data=[int(r["offer_letters"] or 0) for r in rows]),
                ChartSeries(name="Block Amount", data=clean_blocks),
                ChartSeries(name="Counsellor Clashes", data=clash_counts),
                ChartSeries(name="Admissions", data=[int(r["admissions"] or 0) for r in rows]),
            ],
            extra={
                "block_amount_total": block_amounts,
                "stack_block": ["Block Amount", "Counsellor Clashes"],
            },
        )

    def get_state_distribution(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT state, COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} state IS NOT NULL
            GROUP BY state
            ORDER BY leads DESC
            LIMIT 30
            """,
            params,
        )
        return ChartData(
            chart_id="state_distribution",
            chart_type="bar",
            title="State Distribution",
            categories=[r["state"] for r in rows],
            series=[ChartSeries(name="Leads", data=[int(r["leads"]) for r in rows])],
        )

    def get_funnel_data(self, filters: FilterParams) -> ChartData:
        if not self._has_data():
            return empty_funnel()

        where, params = self._build_where(filters)
        stage_cols = {
            "Connected": "connected",
            "MQL": "mql",
            "SQL": "sql",
            "Application": "application",
            "Test Registration": "test_registration",
            "Interview": "interview",
            "Offer Letter": "offer_letter",
            "Block Amount Paid": "block_amount_paid",
            "Admission": "admission",
        }
        available = set(self.duck_repo.get_master_columns())
        select_parts = ["COUNT(*) AS lead_count"]
        for stage, col in stage_cols.items():
            alias = stage.lower().replace(" ", "_")
            if col not in available:
                select_parts.append(f"0 AS {alias}")
            else:
                select_parts.append(f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END) AS {alias}")

        ai_connected_expr = self._ai_connected_condition(available)
        ac_connected_expr = self._ac_connected_condition(available)
        select_parts.append(
            f"SUM(CASE WHEN {ai_connected_expr} THEN 1 ELSE 0 END) AS ai_connected"
        )
        select_parts.append(
            f"SUM(CASE WHEN {ac_connected_expr} THEN 1 ELSE 0 END) AS ac_connected"
        )

        row = self.duck_repo.query_dicts(
            f"SELECT {', '.join(select_parts)} FROM {MASTER_DATASET_TABLE} {where}",
            params,
        )
        cur = row[0] if row else {}

        counts: List[int] = []
        for stage in FUNNEL_STAGES:
            if stage == "Lead":
                counts.append(int(cur.get("lead_count") or 0))
            else:
                alias = stage.lower().replace(" ", "_")
                counts.append(int(cur.get(alias) or 0))

        conversions = []
        drops = []
        for i, count in enumerate(counts):
            if i == 0:
                conversions.append(100.0)
                drops.append(0.0)
            else:
                prev = counts[i - 1]
                conversions.append(round(count / prev * 100, 2) if prev else 0)
                drops.append(round((prev - count) / prev * 100, 2) if prev else 0)

        connected_split = {
            "ai_connected": int(cur.get("ai_connected") or 0),
            "ac_connected": int(cur.get("ac_connected") or 0),
        }

        return ChartData(
            chart_id="funnel",
            chart_type="funnel",
            title="Lead Funnel",
            categories=FUNNEL_STAGES,
            series=[ChartSeries(name="Count", data=counts)],
            extra={
                "conversions": conversions,
                "drops": drops,
                "connected_split": connected_split,
            },
        )

    def get_contactability_breakdown(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        ai_check = self._ai_contacted_condition(available)
        leads_not_touched = (
            LEADS_NOT_TOUCHED_EXPR
            if "last_activity" in available
            else "FALSE"
        )

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                bucket,
                COUNT(*) AS cnt,
                COALESCE(AVG(dial_count), 0) AS avg_dials
            FROM (
                SELECT
                    CASE
                        WHEN {ai_check} THEN 'AI Bot Dialed'
                        WHEN {leads_not_touched} THEN '{LEADS_NOT_TOUCHED_LABEL}'
                        WHEN {SAFE_DIALS_EXPR} = 1 THEN '1 Dial'
                        WHEN {SAFE_DIALS_EXPR} = 2 THEN '2 Dial'
                        WHEN {SAFE_DIALS_EXPR} >= 3 THEN '3+ Dial'
                    END AS bucket,
                    {SAFE_DIALS_EXPR} AS dial_count
                FROM {MASTER_DATASET_TABLE}
                {where}
            ) buckets
            WHERE bucket IS NOT NULL
            GROUP BY bucket
            ORDER BY
                CASE bucket
                    WHEN 'AI Bot Dialed' THEN 1
                    WHEN '{LEADS_NOT_TOUCHED_LABEL}' THEN 2
                    WHEN '1 Dial' THEN 3
                    WHEN '2 Dial' THEN 4
                    ELSE 5
                END
            """,
            params,
        )
        return ChartData(
            chart_id="contactability",
            chart_type="donut",
            title="Contactability Breakdown",
            categories=[r["bucket"] for r in rows],
            series=[ChartSeries(name="Leads", data=[int(r["cnt"]) for r in rows])],
            extra={
                "avg_dials": {r["bucket"]: float(r["avg_dials"]) for r in rows},
                "counts": {r["bucket"]: int(r["cnt"]) for r in rows},
            },
        )

    def get_ai_calling_stats(self, filters: FilterParams) -> Dict[str, Any]:
        if not self._has_data():
            return empty_ai_calling()

        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                {self._ai_sum(available, "ai_contacted", ["ai bot"])} AS calls,
                {self._ai_sum(available, "ai_qualified", [
                    "ai bot qualified - warm",
                    "ai bot qualified - hot",
                    "ai bot qualified - high intent",
                ])} AS qualified,
                {self._ai_sum(available, "ai_warm", ["ai bot qualified - warm"])} AS warm,
                {self._ai_sum(available, "ai_high_intent", ["ai bot qualified - high intent"])} AS high_intent,
                {self._ai_sum(available, "ai_payment_link", ["ai bot sent - payment link"])} AS payment_link,
                {self._ai_sum(available, "ai_brochure", ["ai bot sent - brochure"])} AS brochure,
                {self._ai_sum(available, "dnp", ["ai bot reached - dnp"])} AS dnp,
                {self._ai_sum(available, "ai_interested", [
                    "ai bot qualified - hot",
                    "ai bot qualified - high intent",
                ])} AS interested,
                {self._ai_sum(available, "ai_callback", ["ai bot reached - cb later"])} AS callback
            FROM {MASTER_DATASET_TABLE}
            {where}
            """,
            params,
        )
        return rows[0] if rows else {}

    def get_persona_analytics(self, filters: FilterParams) -> Dict[str, Any]:
        where, params = self._build_where(filters)
        btech_persona = (
            "REPLACE(LOWER(REPLACE(TRIM(persona), '.', '')), ' ', '') = 'knowmoreaboutbtech'"
        )
        # Non-blank persona that is not Know More about B.Tech (Other Persona summary).
        other_persona_sql = (
            "NULLIF(TRIM(COALESCE(persona, '')), '') IS NOT NULL "
            f"AND NOT ({btech_persona})"
        )
        persona_clause = f"{'AND' if where else 'WHERE'} persona IS NOT NULL AND {btech_persona}"
        know_more_event = (
            "REPLACE(LOWER(REPLACE(TRIM(CAST(COALESCE(a.notes, '') AS VARCHAR)), '.', '')), ' ', '') "
            "= 'knowmoreaboutbtech'"
        )
        activity_in_last_24h = (
            "TRY_CAST(CAST(a.activity_date AS VARCHAR) AS TIMESTAMP) "
            ">= (CURRENT_TIMESTAMP - INTERVAL 24 HOUR)"
        )
        # Leads created in the last 24 hours (main DB), including Kollege Apply.
        created_last_24h = "date >= (CURRENT_TIMESTAMP - INTERVAL 24 HOUR)"
        has_activity_sheet = self.duck_repo.persona_activity_exists()

        # Interested = distinct leads matched to Know More about B.Tech activities
        # in the last 24 hours (Kollege Apply included; master persona not required).
        activity_params: List[Any] = []
        if has_activity_sheet:
            matched_id_rows = self.duck_repo.query_dicts(
                f"""
                SELECT DISTINCT prospect_id FROM (
                    SELECT m.prospect_id
                    FROM {MASTER_DATASET_TABLE} m
                    INNER JOIN {PERSONA_ACTIVITY_TABLE} a
                      ON LOWER(TRIM(CAST(COALESCE(m.prospect_id, '') AS VARCHAR)))
                       = LOWER(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR)))
                    WHERE NULLIF(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR)), '') IS NOT NULL
                      AND m.prospect_id IS NOT NULL
                      AND {know_more_event}
                      AND {activity_in_last_24h}
                    UNION
                    SELECT m.prospect_id
                    FROM {MASTER_DATASET_TABLE} m
                    INNER JOIN {PERSONA_ACTIVITY_TABLE} a
                      ON LOWER(TRIM(CAST(COALESCE(m.email, '') AS VARCHAR)))
                       = LOWER(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)))
                    WHERE NULLIF(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)), '') IS NOT NULL
                      AND m.prospect_id IS NOT NULL
                      AND {know_more_event}
                      AND {activity_in_last_24h}
                ) matched
                """
            )
            matched_ids = [
                r["prospect_id"] for r in matched_id_rows if r.get("prospect_id") is not None
            ]
            if matched_ids:
                placeholders = ", ".join(["?"] * len(matched_ids))
                activity_matched = f"prospect_id IN ({placeholders})"
                activity_params = matched_ids
            else:
                activity_matched = "FALSE"
        else:
            activity_matched = "FALSE"

        interested_last_24h = f"({activity_matched})"

        empty_charts = {
            "partner_overall": ChartData(
                chart_id="persona_partner_overall",
                chart_type="bar",
                title="Partners — Overall",
                categories=[],
                series=[ChartSeries(name="Leads", data=[])],
            ),
            "partner_last_24h": ChartData(
                chart_id="persona_partner_last_24h",
                chart_type="pie",
                title="Partners — Last 24h",
                categories=[],
                series=[ChartSeries(name="Leads", data=[])],
            ),
            "stage_overall": ChartData(
                chart_id="persona_stage_overall",
                chart_type="pie",
                title="Persona Overall",
                categories=[],
                series=[ChartSeries(name="Leads", data=[])],
            ),
            "stage_last_24h": ChartData(
                chart_id="persona_stage_last_24h",
                chart_type="pie",
                title="Persona Last 24h — Created vs Interested",
                categories=[],
                series=[ChartSeries(name="Leads", data=[])],
            ),
        }

        activity_sheet = {
            "has_data": has_activity_sheet,
            "report_rows": 0,
            "matched_leads": 0,
            "unmatched_report_rows": 0,
            "source_filename": None,
            "uploaded_at": None,
        }

        if not self._has_data():
            return {
                "summary": {
                    "know_more_about_btech": 0,
                    "other_persona": 0,
                    "know_more": 0,
                    "registration": 0,
                    "offer_letter_sent": 0,
                    "know_more_about_btech_last_24h": 0,
                    "created_last_24h": 0,
                },
                "rows": [],
                "charts": empty_charts,
                "activity_sheet": activity_sheet,
            }

        def _params(*extra: List[Any]) -> List[Any]:
            out = list(params)
            for chunk in extra:
                out.extend(chunk)
            return out

        if has_activity_sheet:
            from app.services.persona_activity_service import PersonaActivityService

            status = PersonaActivityService(duck_repo=self.duck_repo).get_status()
            activity_sheet["source_filename"] = status.get("source_filename")
            activity_sheet["uploaded_at"] = status.get("uploaded_at")
            activity_sheet["report_rows"] = int(status.get("row_count") or 0)

            match_stats = self.duck_repo.query_dicts(
                f"""
                SELECT
                    (
                        SELECT COUNT(*) FROM {PERSONA_ACTIVITY_TABLE} a
                        WHERE {know_more_event} AND {activity_in_last_24h}
                    ) AS report_rows,
                    (
                        SELECT COUNT(*) FROM (
                            SELECT DISTINCT
                                COALESCE(
                                    NULLIF(TRIM(CAST(COALESCE(a.activity_id, '') AS VARCHAR)), ''),
                                    LOWER(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR))) || '|' ||
                                    LOWER(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)))
                                ) AS row_key
                            FROM {PERSONA_ACTIVITY_TABLE} a
                            INNER JOIN {MASTER_DATASET_TABLE} m
                              ON LOWER(TRIM(CAST(COALESCE(m.prospect_id, '') AS VARCHAR)))
                               = LOWER(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR)))
                            WHERE NULLIF(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR)), '') IS NOT NULL
                              AND {know_more_event}
                              AND {activity_in_last_24h}
                            UNION
                            SELECT DISTINCT
                                COALESCE(
                                    NULLIF(TRIM(CAST(COALESCE(a.activity_id, '') AS VARCHAR)), ''),
                                    LOWER(TRIM(CAST(COALESCE(a.prospect_id, '') AS VARCHAR))) || '|' ||
                                    LOWER(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)))
                                ) AS row_key
                            FROM {PERSONA_ACTIVITY_TABLE} a
                            INNER JOIN {MASTER_DATASET_TABLE} m
                              ON LOWER(TRIM(CAST(COALESCE(m.email, '') AS VARCHAR)))
                               = LOWER(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)))
                            WHERE NULLIF(TRIM(CAST(COALESCE(a.match_email, '') AS VARCHAR)), '') IS NOT NULL
                              AND {know_more_event}
                              AND {activity_in_last_24h}
                        ) x
                    ) AS matched_report_rows
                """
            )
            if match_stats:
                report_rows = int(match_stats[0].get("report_rows") or 0)
                matched_report = int(match_stats[0].get("matched_report_rows") or 0)
                activity_sheet["report_rows"] = report_rows
                activity_sheet["unmatched_report_rows"] = max(0, report_rows - matched_report)

        # Other Persona: main DB only — any non-blank persona except Know More about B.Tech.
        other_persona_rows = self.duck_repo.query_dicts(
            f"""
            SELECT COUNT(*) AS other_persona
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} {other_persona_sql}
            """,
            list(params),
        )
        other_persona = int(
            (other_persona_rows[0].get("other_persona") if other_persona_rows else 0) or 0
        )

        # Created last 24h (all personas, incl. Kollege) vs Know More activity matches.
        # Use a CTE so partner WHERE placeholders bind before activity IN placeholders
        # (DuckDB binds ? in appearance order across the full SQL text).
        compare_rows = self.duck_repo.query_dicts(
            f"""
            WITH scoped AS (
                SELECT * FROM {MASTER_DATASET_TABLE}
                {where if where else ""}
            )
            SELECT
                SUM(CASE WHEN {created_last_24h} THEN 1 ELSE 0 END) AS created_last_24h,
                SUM(
                    CASE
                        WHEN {interested_last_24h}
                        THEN 1 ELSE 0
                    END
                ) AS interested_btech_last_24h
            FROM scoped
            """,
            _params(activity_params),
        )
        created_count = int(
            (compare_rows[0].get("created_last_24h") if compare_rows else 0) or 0
        )
        interested_count = int(
            (compare_rows[0].get("interested_btech_last_24h") if compare_rows else 0) or 0
        )
        activity_sheet["matched_leads"] = interested_count

        summary_rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                COUNT(*) AS know_more_about_btech,
                SUM(CASE WHEN test_registration THEN 1 ELSE 0 END) AS registration,
                SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letter_sent
            FROM {MASTER_DATASET_TABLE}
            {where}
            {persona_clause}
            """,
            list(params),
        )
        summary = summary_rows[0] if summary_rows else {}

        rows = self.duck_repo.query_dicts(
            f"""
            WITH scoped AS (
                SELECT * FROM {MASTER_DATASET_TABLE}
                {where}
                {persona_clause}
            )
            SELECT persona, partner,
                   COUNT(*) AS total,
                   SUM(CASE WHEN persona_know_more THEN 1 ELSE 0 END) AS know_more,
                   SUM(
                       CASE
                           WHEN {interested_last_24h} THEN 1 ELSE 0
                       END
                   ) AS know_more_last_24h,
                   SUM(CASE WHEN persona_application_started THEN 1 ELSE 0 END) AS app_started,
                   SUM(CASE WHEN test_registration THEN 1 ELSE 0 END) AS test_registered,
                   SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letter,
                   SUM(CASE WHEN fee_paid THEN 1 ELSE 0 END) AS fee_paid,
                   SUM(CASE WHEN funnel_stage = 'Lead' AND NOT connected THEN 1 ELSE 0 END) AS drop_off
            FROM scoped
            GROUP BY persona, partner
            ORDER BY total DESC
            LIMIT 100
            """,
            _params(activity_params),
        )

        partner_overall = self.duck_repo.query_dicts(
            f"""
            SELECT COALESCE(NULLIF(TRIM(partner), ''), 'Unknown') AS partner,
                   COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {persona_clause}
            GROUP BY 1
            ORDER BY leads DESC
            LIMIT 12
            """,
            list(params),
        )
        # Partner Last 24h donut = Know More about B.Tech activities (incl. Kollege).
        partner_last_24h = self.duck_repo.query_dicts(
            f"""
            SELECT COALESCE(NULLIF(TRIM(partner), ''), 'Unknown') AS partner,
                   COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} {interested_last_24h}
            GROUP BY 1
            ORDER BY leads DESC
            LIMIT 12
            """,
            _params(activity_params),
        )

        stage_sql = f"""
            SELECT
                SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letter,
                SUM(CASE WHEN test_registration AND NOT offer_letter THEN 1 ELSE 0 END) AS registration,
                SUM(
                    CASE
                        WHEN persona_know_more
                             AND NOT test_registration
                             AND NOT offer_letter
                        THEN 1 ELSE 0
                    END
                ) AS know_more_only,
                SUM(
                    CASE
                        WHEN NOT offer_letter
                             AND NOT test_registration
                             AND NOT COALESCE(persona_know_more, FALSE)
                        THEN 1 ELSE 0
                    END
                ) AS other
            FROM {MASTER_DATASET_TABLE}
            {{where}}
            {{persona_clause}}
            {{extra}}
        """
        stage_overall_rows = self.duck_repo.query_dicts(
            stage_sql.format(where=where, persona_clause=persona_clause, extra=""),
            list(params),
        )

        def _stage_chart(
            chart_id: str, title: str, row: Dict[str, Any]
        ) -> ChartData:
            labels = [
                "Offer Letter Sent",
                "Registration",
                "Know More Only",
                "Other B.Tech (no Know More / Reg / Offer)",
            ]
            values = [
                int(row.get("offer_letter") or 0),
                int(row.get("registration") or 0),
                int(row.get("know_more_only") or 0),
                int(row.get("other") or 0),
            ]
            keep = [(l, v) for l, v in zip(labels, values) if v > 0]
            return ChartData(
                chart_id=chart_id,
                chart_type="pie",
                title=title,
                categories=[l for l, _ in keep],
                series=[ChartSeries(name="Leads", data=[v for _, v in keep])],
                extra={
                    "other_btech_definition": (
                        "Other B.Tech = Know More about B.Tech persona leads who do not have "
                        "Know More flagged, Registration, or Offer Letter yet."
                    )
                },
            )

        def _partner_chart(
            chart_id: str,
            title: str,
            partner_rows: List[Dict[str, Any]],
            chart_type: str = "bar",
        ) -> ChartData:
            return ChartData(
                chart_id=chart_id,
                chart_type=chart_type,
                title=title,
                categories=[str(r["partner"]) for r in partner_rows],
                series=[
                    ChartSeries(
                        name="Leads",
                        data=[int(r["leads"] or 0) for r in partner_rows],
                    )
                ],
            )

        # Created (main DB last 24h) vs Interested (activity Know More about B.Tech).
        compare_categories = [
            "Created (Last 24h)",
            "Know More about B.Tech (Activity)",
        ]
        compare_values = [created_count, interested_count]
        stage_last_24h = ChartData(
            chart_id="persona_stage_last_24h",
            chart_type="pie",
            title="Persona Last 24h — Created vs Interested",
            categories=compare_categories if any(compare_values) else [],
            series=[
                ChartSeries(
                    name="Leads",
                    data=compare_values if any(compare_values) else [],
                )
            ],
            extra={
                "comparison": {
                    "created_last_24h": created_count,
                    "interested_btech_activity": interested_count,
                    "definition": (
                        "Created = main-dataset leads created in the last 24 hours "
                        "(including Kollege Apply). Interested = distinct leads matched to "
                        "Know More about B.Tech activity events in the last 24 hours "
                        "(including Kollege Apply)."
                    ),
                }
            },
        )

        return {
            "summary": {
                "know_more_about_btech": int(summary.get("know_more_about_btech") or 0),
                "other_persona": other_persona,
                # Backward-compatible alias for older clients.
                "know_more": other_persona,
                "registration": int(summary.get("registration") or 0),
                "offer_letter_sent": int(summary.get("offer_letter_sent") or 0),
                "know_more_about_btech_last_24h": interested_count,
                "created_last_24h": created_count,
            },
            "rows": rows,
            "charts": {
                "partner_overall": _partner_chart(
                    "persona_partner_overall",
                    "Partners — Overall (Know More about B.Tech)",
                    partner_overall,
                    chart_type="bar",
                ),
                "partner_last_24h": _partner_chart(
                    "persona_partner_last_24h",
                    "Partners — Know More about B.Tech (Last 24h)",
                    partner_last_24h,
                    chart_type="pie",
                ),
                "stage_overall": _stage_chart(
                    "persona_stage_overall",
                    "Persona Overall",
                    stage_overall_rows[0] if stage_overall_rows else {},
                ),
                "stage_last_24h": stage_last_24h,
            },
            "activity_sheet": activity_sheet,
        }

    def get_campaign_analytics(self, filters: FilterParams) -> List[Dict[str, Any]]:
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())

        def flag_sum(col: str) -> str:
            if col in available:
                return f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END)"
            return "0"

        return self.duck_repo.query_dicts(
            f"""
            SELECT source, medium, campaign, partner, state,
                   COUNT(*) AS leads,
                   {flag_sum("application")} AS applications,
                   {flag_sum("block_amount_paid")} AS block_amount_paid,
                   {flag_sum("admission")} AS admissions,
                   COALESCE(SUM(revenue), 0) AS revenue,
                   COALESCE(SUM(partner_cost), 0) AS cost,
                   CASE WHEN COALESCE(SUM(partner_cost), 0) > 0
                        THEN COALESCE(SUM(revenue), 0) / SUM(partner_cost) ELSE 0 END AS roi,
                   CASE WHEN SUM(CASE WHEN application THEN 1 ELSE 0 END) > 0
                        THEN COALESCE(SUM(partner_cost), 0) / SUM(CASE WHEN application THEN 1 ELSE 0 END)
                        ELSE 0 END AS cpa
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY source, medium, campaign, partner, state
            ORDER BY leads DESC
            LIMIT 200
            """,
            params,
        )

    def get_geographic_state_summary(self, filters: FilterParams) -> List[Dict[str, Any]]:
        """Per-state totals plus a breakdown by funnel stage, for the India map."""
        if not self._has_data():
            return []
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT state, funnel_stage,
                   COUNT(*) AS cnt,
                   SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS adm,
                   SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_paid
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} state IS NOT NULL
            GROUP BY state, funnel_stage
            """,
            params,
        )
        agg: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            state = r["state"]
            entry = agg.setdefault(
                state,
                {
                    "state": state,
                    "leads": 0,
                    "admissions": 0,
                    "block_amount_paid": 0,
                    "stages": {},
                },
            )
            cnt = int(r["cnt"] or 0)
            entry["leads"] += cnt
            entry["admissions"] += int(r["adm"] or 0)
            entry["block_amount_paid"] += int(r["block_paid"] or 0)
            stage = r.get("funnel_stage") or "Lead"
            entry["stages"][stage] = entry["stages"].get(stage, 0) + cnt
        return sorted(agg.values(), key=lambda x: x["leads"], reverse=True)

    def get_geographic_data(self, filters: FilterParams) -> List[Dict[str, Any]]:
        where, params = self._build_where(filters)
        return self.duck_repo.query_dicts(
            f"""
            SELECT state, city, partner,
                   COUNT(*) AS leads,
                   SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid,
                   SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} state IS NOT NULL
            GROUP BY state, city, partner
            ORDER BY leads DESC
            LIMIT 500
            """,
            params,
        )

    # Revenue recognised per successful admission (Block ROI is the admission proxy).
    REVENUE_PER_ADMISSION_INR = 550_000

    def get_revenue_dashboard(self, filters: FilterParams) -> Dict[str, Any]:
        """Partner ROI with Block ROI as admission proxy.

        Cost = Advance + (Incentive × Block ROI); College Wollege = Advance only.
        Revenue = ₹5.5L × Block ROI. Break even when Revenue ≥ Cost.
        """
        import math

        if not self._has_data():
            return empty_revenue()

        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT partner,
                   COUNT(*) AS leads,
                   SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                   SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} partner IS NOT NULL
            GROUP BY partner
            """,
            params,
        )
        admissions_by_partner: Dict[str, int] = {}
        leads_by_partner: Dict[str, int] = {}
        block_by_partner: Dict[str, int] = {}
        for r in rows:
            name = canonical_partner(r.get("partner")) or str(r.get("partner") or "")
            admissions_by_partner[name] = admissions_by_partner.get(name, 0) + int(
                r.get("admissions") or 0
            )
            leads_by_partner[name] = leads_by_partner.get(name, 0) + int(r.get("leads") or 0)
            block_by_partner[name] = block_by_partner.get(name, 0) + int(
                r.get("block_amount_paid") or 0
            )

        # Counsellor clashes from block payment backtracking — excluded from ROI units.
        clashes = self._get_partner_counsellor_clashes(filters)
        clash_by_partner: Dict[str, int] = {}
        for item in clashes.get("by_partner", []):
            pname = canonical_partner(item.get("partner")) or str(item.get("partner") or "")
            clash_by_partner[pname] = clash_by_partner.get(pname, 0) + int(item.get("count") or 0)

        revenue_per_admission = float(self.REVENUE_PER_ADMISSION_INR)
        partners_out: List[Dict[str, Any]] = []
        for partner in PARTNER_CANONICAL:
            commercials = PARTNER_COMMERCIALS.get(partner, {})
            advance = float(commercials.get("advance") or 0)
            incentive = float(commercials.get("incentive_per_admission") or 0)
            # Advance-only partners (e.g. College Wollege): no per-admission incentive.
            advance_only = bool(commercials.get("advance_only")) or incentive <= 0
            admissions = int(admissions_by_partner.get(partner, 0))
            leads = int(leads_by_partner.get(partner, 0))
            block_paid = int(block_by_partner.get(partner, 0))
            counsellor_clashes = int(clash_by_partner.get(partner, 0))
            # Hypothesis: Block ROI count stands in for successful admissions.
            block_roi = max(0, block_paid - counsellor_clashes)

            if advance_only:
                incentive = 0.0
                incentive_total = 0.0
                cost = advance
            else:
                incentive_total = block_roi * incentive
                cost = advance + incentive_total

            revenue = block_roi * revenue_per_admission
            profit = revenue - cost
            roi_pct = (profit / cost * 100) if cost > 0 else 0.0
            # Cash shortfall to break even (0 when already at/above).
            gap_to_breakeven = max(0.0, cost - revenue)

            if revenue >= cost:
                status = "Break even"
                blocks_needed = 0
            else:
                status = "Below break even"
                # Contribution per additional Block ROI admission toward closing the gap.
                contribution = revenue_per_admission - incentive
                if contribution > 0:
                    blocks_needed = int(math.ceil(gap_to_breakeven / contribution))
                else:
                    blocks_needed = None

            partners_out.append(
                {
                    "partner": partner,
                    "advance": advance,
                    "incentive_per_admission": incentive,
                    "advance_only": advance_only,
                    "leads": leads,
                    "admissions": admissions,
                    "block_amount_paid": block_paid,
                    "counsellor_clashes": counsellor_clashes,
                    "block_amount_roi": block_roi,
                    "incentive_total": incentive_total,
                    "cost": cost,
                    "revenue": revenue,
                    "profit": profit,
                    "roi_pct": round(roi_pct, 2),
                    "revenue_per_admission": revenue_per_admission,
                    "gap_to_breakeven": round(gap_to_breakeven, 2),
                    "blocks_needed": blocks_needed,
                    "status": status,
                }
            )

        for name, admissions in admissions_by_partner.items():
            if name in PARTNER_COMMERCIALS:
                continue
            block_paid = int(block_by_partner.get(name, 0))
            counsellor_clashes = int(clash_by_partner.get(name, 0))
            block_roi = max(0, block_paid - counsellor_clashes)
            partners_out.append(
                {
                    "partner": name,
                    "advance": None,
                    "incentive_per_admission": None,
                    "advance_only": False,
                    "leads": leads_by_partner.get(name, 0),
                    "admissions": admissions,
                    "block_amount_paid": block_paid,
                    "counsellor_clashes": counsellor_clashes,
                    "block_amount_roi": block_roi,
                    "incentive_total": None,
                    "cost": None,
                    "revenue": block_roi * revenue_per_admission,
                    "profit": None,
                    "roi_pct": None,
                    "revenue_per_admission": revenue_per_admission,
                    "gap_to_breakeven": None,
                    "blocks_needed": None,
                    "status": "No commercials",
                }
            )

        tracked = [p for p in partners_out if p.get("cost") is not None]
        cost_total = sum(float(p["cost"] or 0) for p in tracked)
        revenue_total = sum(float(p["revenue"] or 0) for p in tracked)
        profit_total = revenue_total - cost_total
        return {
            "partners": partners_out,
            "totals": {
                "admissions": sum(int(p["admissions"] or 0) for p in tracked),
                "block_amount_paid": sum(int(p["block_amount_paid"] or 0) for p in tracked),
                "counsellor_clashes": sum(int(p["counsellor_clashes"] or 0) for p in tracked),
                "block_amount_roi": sum(int(p["block_amount_roi"] or 0) for p in tracked),
                "advance_total": sum(float(p["advance"] or 0) for p in tracked),
                "incentive_total": sum(float(p["incentive_total"] or 0) for p in tracked),
                "cost_total": cost_total,
                "revenue_total": revenue_total,
                "profit_total": profit_total,
                "revenue_per_admission": revenue_per_admission,
                "breakeven_partners": sum(
                    1 for p in tracked if p.get("status") == "Break even"
                ),
                "partners_below_breakeven": sum(
                    1 for p in tracked if p.get("status") == "Below break even"
                ),
                "has_clash_sheet": bool(clashes.get("has_sheet")),
            },
        }

    def get_predictive_analytics(self, filters: FilterParams) -> Dict[str, Any]:
        if not self._has_data():
            return empty_predictive()

        where, params = self._build_where(filters)
        monthly = self.duck_repo.query_dicts(
            f"""
            SELECT month,
                   COUNT(*) AS leads,
                   SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid,
                   SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} month IS NOT NULL AND TRIM(CAST(month AS VARCHAR)) <> ''
            GROUP BY month
            ORDER BY month
            """,
            params,
        )
        partner_growth = self.duck_repo.query_dicts(
            f"""
            SELECT partner, month, COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} partner IS NOT NULL
            GROUP BY partner, month
            ORDER BY month, partner
            """,
            params,
        )

        lead_fc = self._jump_forecast_through_august(monthly, "leads")
        block_fc = self._jump_forecast_through_august(monthly, "block_amount_paid")

        return {
            "monthly_history": monthly,
            "partner_growth": partner_growth,
            "lead_forecast": lead_fc["forecast_points"],
            "block_amount_forecast": block_fc["forecast_points"],
            "avg_lead_jump_pct": lead_fc["avg_jump_pct"],
            "avg_block_jump_pct": block_fc["avg_jump_pct"],
            "lead_months_used": lead_fc.get("months_used", 0),
            "block_months_used": block_fc.get("months_used", 0),
            "forecast_horizon": {"from": "2026-07", "to": "2026-08"},
            "lead_chart": ChartData(
                chart_id="lead_forecast",
                chart_type="line",
                title="Lead Forecast (through August)",
                categories=lead_fc["categories"],
                series=[
                    ChartSeries(name="Current Leads", data=lead_fc["current"]),
                    ChartSeries(name="Expected Leads", data=lead_fc["expected"]),
                ],
                extra={"forecast_style": True},
            ),
            "block_amount_chart": ChartData(
                chart_id="block_amount_forecast",
                chart_type="line",
                title="Block Amount Forecast (through August)",
                categories=block_fc["categories"],
                series=[
                    ChartSeries(name="Current Block Amount", data=block_fc["current"]),
                    ChartSeries(name="Expected Block Amount", data=block_fc["expected"]),
                ],
                extra={"forecast_style": True},
            ),
        }

    def _parse_month_key(self, value: Any) -> Optional[str]:
        raw = str(value or "").strip()
        if not raw:
            return None
        # Already YYYY-MM
        if len(raw) >= 7 and raw[4] == "-" and raw[:4].isdigit():
            return raw[:7]
        return raw

    def _month_add(self, month_key: str, delta: int) -> str:
        year = int(month_key[:4])
        month = int(month_key[5:7])
        month += delta
        while month > 12:
            month -= 12
            year += 1
        while month < 1:
            month += 12
            year -= 1
        return f"{year:04d}-{month:02d}"

    def _average_mom_jump(self, values: List[float]) -> float:
        """Average month-over-month growth using every previous month in the series.

        Builds a jump for each consecutive pair across the full history (not only
        the last few months), then returns the mean multiplier.
        """
        if len(values) < 2:
            return 1.0

        jumps: List[float] = []
        for i in range(1, len(values)):
            prev = float(values[i - 1] or 0)
            cur = float(values[i] or 0)
            if prev <= 0:
                continue
            jumps.append(cur / prev)

        if not jumps:
            return 1.0

        mean_jump = sum(jumps) / len(jumps)
        # Soft band so a single extreme month cannot dominate the projection.
        return max(0.5, min(3.0, mean_jump))

    def _linear_next_from_history(self, values: List[float]) -> Optional[float]:
        """Next-period estimate from a linear trend fitted on all previous months."""
        if len(values) < 2:
            return None
        n = len(values)
        x_mean = (n - 1) / 2.0
        y_mean = sum(values) / n
        num = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
        den = sum((i - x_mean) ** 2 for i in range(n)) or 1.0
        slope = num / den
        intercept = y_mean - slope * x_mean
        return max(0.0, intercept + slope * n)

    def _jump_forecast_through_august(
        self, monthly: List[Dict[str, Any]], field: str
    ) -> Dict[str, Any]:
        """
        Forecast July–August using all previous months:
        - MoM jump = mean of every consecutive month pair in history
        - Blended with a linear trend fitted on the same full history
        """
        rows: List[tuple] = []
        for r in monthly:
            key = self._parse_month_key(r.get("month"))
            if not key:
                continue
            rows.append((key, float(r.get(field) or 0)))
        rows.sort(key=lambda x: x[0])

        if not rows:
            return {
                "categories": [],
                "current": [],
                "expected": [],
                "forecast_points": [],
                "avg_jump_pct": 0.0,
                "months_used": 0,
            }

        year = int(rows[-1][0][:4])
        july = f"{year}-07"
        august = f"{year}-08"
        start = rows[0][0]
        # Continuous month list from first history month through August.
        categories: List[str] = []
        if start > august:
            categories = [r[0] for r in rows if r[0] <= august]
        else:
            cursor = start
            while cursor <= august:
                categories.append(cursor)
                cursor = self._month_add(cursor, 1)

        actual_map = {k: v for k, v in rows if k <= august}

        # All months before July — include gaps as 0 so the full timeline is used.
        history_months = [m for m in categories if m < july]
        history_for_jump = [float(actual_map.get(m, 0.0)) for m in history_months]
        if sum(1 for v in history_for_jump if v > 0) < 2:
            # Fall back to every available actual before August.
            history_months = [m for m in categories if m < august]
            history_for_jump = [float(actual_map.get(m, 0.0)) for m in history_months]

        jump = self._average_mom_jump(history_for_jump)
        avg_jump_pct = round((jump - 1.0) * 100, 2)
        linear_next = self._linear_next_from_history(history_for_jump)

        # Base = last month with actual data before the forecast window.
        base_month = None
        for m in reversed(history_months):
            if actual_map.get(m, 0) > 0 or m in actual_map:
                if m in actual_map:
                    base_month = m
                    break
        base_value = float(actual_map.get(base_month, 0.0)) if base_month else (
            next((v for v in reversed(history_for_jump) if v > 0), 0.0)
        )

        jump_july = max(0.0, base_value * jump) if base_value else 0.0
        if linear_next is not None and base_value > 0:
            july_expected = round(0.5 * jump_july + 0.5 * linear_next, 2)
        else:
            july_expected = round(jump_july, 2)

        # August continues from July expected using the same all-history jump.
        august_from_jump = july_expected * jump
        if linear_next is not None and len(history_for_jump) >= 2:
            # Extend the same linear trend one more step beyond July.
            n = len(history_for_jump)
            x_mean = (n - 1) / 2.0
            y_mean = sum(history_for_jump) / n
            num = sum((i - x_mean) * (history_for_jump[i] - y_mean) for i in range(n))
            den = sum((i - x_mean) ** 2 for i in range(n)) or 1.0
            slope = num / den
            intercept = y_mean - slope * x_mean
            linear_aug = max(0.0, intercept + slope * (n + 1))
            august_expected = round(0.5 * august_from_jump + 0.5 * linear_aug, 2)
        else:
            august_expected = round(max(0.0, august_from_jump), 2)

        forecast_points = [
            {"period": july, "value": july_expected, "type": "expected"},
            {"period": august, "value": august_expected, "type": "expected"},
        ]

        current: List[Any] = []
        expected: List[Any] = []
        for m in categories:
            actual = actual_map.get(m)
            if actual is not None:
                current.append(int(actual) if actual == int(actual) else round(actual, 2))
            else:
                current.append(None)

            if m == july:
                expected.append(july_expected)
            elif m == august:
                expected.append(august_expected)
            elif m == base_month and base_month is not None:
                expected.append(
                    int(base_value) if base_value == int(base_value) else round(base_value, 2)
                )
            else:
                expected.append(None)

        return {
            "categories": categories,
            "current": current,
            "expected": expected,
            "forecast_points": forecast_points,
            "avg_jump_pct": avg_jump_pct,
            "months_used": len(history_months),
        }

    def _simple_forecast(self, data: List[Dict[str, Any]], field: str, periods: int = 3) -> List[Dict[str, Any]]:
        if len(data) < 2:
            return []
        values = [float(d.get(field) or 0) for d in data]
        n = len(values)
        x_mean = (n - 1) / 2
        y_mean = sum(values) / n
        num = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
        den = sum((i - x_mean) ** 2 for i in range(n)) or 1
        slope = num / den
        intercept = y_mean - slope * x_mean
        forecast = []
        for i in range(n, n + periods):
            forecast.append({"period": f"F+{i - n + 1}", "value": round(intercept + slope * i, 2)})
        return forecast

    def get_partner_detail(self, filters: FilterParams, partner: str) -> Dict[str, Any]:
        pf = FilterParams(**{**filters.model_dump(), "partner": [partner]})
        where, params = self._build_where(pf)
        overview = self.duck_repo.query_dicts(
            f"""
            SELECT partner,
                   COUNT(*) AS total_leads,
                   SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected,
                   SUM(CASE WHEN admission THEN 1 ELSE 0 END) AS admissions,
                   SUM(CASE WHEN offer_letter THEN 1 ELSE 0 END) AS offer_letters,
                   SUM(CASE WHEN application THEN 1 ELSE 0 END) AS applications,
                   SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END) AS block_amount_paid,
                   COALESCE(SUM(revenue), 0) AS revenue,
                   COALESCE(AVG(conversion_pct), 0) AS avg_conversion
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY partner
            """,
            params,
        )
        states = self.duck_repo.query_dicts(
            f"""
            SELECT state, COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} state IS NOT NULL
            GROUP BY state ORDER BY leads DESC LIMIT 10
            """,
            params,
        )
        trend = self.duck_repo.query_dicts(
            f"""
            SELECT month, COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY month ORDER BY month
            """,
            params,
        )
        block_amount_leads = self.duck_repo.query_dicts(
            f"""
            SELECT prospect_id, name, email, phone, state, city,
                   lead_stage, contact_stage, funnel_stage, date, revenue
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} block_amount_paid
            ORDER BY date DESC NULLS LAST
            LIMIT 500
            """,
            params,
        )
        contact_stage_rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                COALESCE(NULLIF(TRIM(contact_stage), ''), '(Blank)') AS contact_stage,
                COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY 1
            ORDER BY leads DESC, contact_stage
            """,
            params,
        )
        total_for_pct = sum(int(r.get("leads") or 0) for r in contact_stage_rows) or 0
        contact_stage_summary = [
            {
                "contact_stage": str(r.get("contact_stage") or "(Blank)"),
                "leads": int(r.get("leads") or 0),
                "pct": round(int(r.get("leads") or 0) / total_for_pct * 100, 2)
                if total_for_pct
                else 0.0,
            }
            for r in contact_stage_rows
        ]
        daily = self.get_time_series_chart(pf, "daily")
        weekly = self.get_time_series_chart(pf, "weekly")
        monthly = self.get_time_series_chart(pf, "monthly")
        return {
            "partner": partner,
            "overview": overview[0] if overview else {},
            "top_states": states,
            "trend": trend,
            "daily_leads": daily.model_dump() if hasattr(daily, "model_dump") else daily,
            "weekly_leads": weekly.model_dump() if hasattr(weekly, "model_dump") else weekly,
            "monthly_leads": monthly.model_dump() if hasattr(monthly, "model_dump") else monthly,
            "block_amount_leads": block_amount_leads,
            "contact_stage_summary": contact_stage_summary,
            "block_counsellor_clashes": self._get_partner_counsellor_clashes(
                filters, partner=partner
            ),
            "performance_score": self._partner_score(overview[0] if overview else {}),
        }

    def _counsellor_payment_expr(self, column: str = "source_at_payment") -> str:
        return f"LOWER(COALESCE({column}, '')) LIKE '%counsell%'"

    @staticmethod
    def _is_counsellor_payment_source(value: Any) -> bool:
        return "counsell" in str(value or "").lower()

    def _matched_block_payment_cte(self, where: str, block_clause: str) -> str:
        """Shared CTE: block-paid master rows matched to payment sheet by email then phone."""
        return f"""
            WITH paid AS (
                SELECT
                    prospect_id,
                    name,
                    email,
                    phone,
                    partner,
                    source AS contact_source,
                    LOWER(TRIM(COALESCE(email, ''))) AS norm_email,
                    regexp_replace(COALESCE(CAST(phone AS VARCHAR), ''), '[^0-9]', '', 'g') AS norm_phone
                FROM {MASTER_DATASET_TABLE}
                {where}
                {block_clause}
            ),
            email_match AS (
                SELECT
                    p.prospect_id,
                    s.source_at_payment,
                    s.campaign_at_payment,
                    s.college_code,
                    s.full_name AS sheet_name,
                    s.email AS sheet_email,
                    s.phone AS sheet_phone,
                    'email' AS match_method
                FROM paid p
                INNER JOIN {BLOCK_PAYMENT_TABLE} s
                    ON p.norm_email = s.match_email
                WHERE p.norm_email <> '' AND s.match_email IS NOT NULL
            ),
            phone_match AS (
                SELECT
                    p.prospect_id,
                    s.source_at_payment,
                    s.campaign_at_payment,
                    s.college_code,
                    s.full_name AS sheet_name,
                    s.email AS sheet_email,
                    s.phone AS sheet_phone,
                    'phone' AS match_method
                FROM paid p
                INNER JOIN {BLOCK_PAYMENT_TABLE} s
                    ON p.norm_phone = s.match_phone
                WHERE p.prospect_id NOT IN (SELECT prospect_id FROM email_match)
                  AND p.norm_phone <> ''
                  AND LENGTH(p.norm_phone) >= 10
                  AND s.match_phone IS NOT NULL
            ),
            matches AS (
                SELECT * FROM email_match
                UNION ALL
                SELECT * FROM phone_match
            )
        """

    def _counsellor_clash_counts_by_partner(
        self, filters: FilterParams, partner: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Lightweight partner → counsellor clash counts (no row materialization)."""
        if not self.duck_repo.block_payment_exists() or not self._has_data():
            return []
        where, params = self._build_where(filters)
        block_clause = f"{'AND' if where else 'WHERE'} block_amount_paid"
        counsellor = self._counsellor_payment_expr("m.source_at_payment")
        partner_filter = ""
        if partner:
            partner_filter = "AND p.partner = ?"
            params = list(params) + [partner]
        cte = self._matched_block_payment_cte(where, block_clause)
        rows = self.duck_repo.query_dicts(
            f"""
            {cte}
            SELECT p.partner AS partner, COUNT(*) AS count
            FROM paid p
            INNER JOIN matches m ON p.prospect_id = m.prospect_id
            WHERE p.partner IS NOT NULL
              AND {counsellor}
              {partner_filter}
            GROUP BY p.partner
            ORDER BY count DESC
            """,
            params,
        )
        return [
            {"partner": str(r["partner"]), "count": int(r["count"] or 0)}
            for r in rows
            if r.get("partner")
        ]

    def _counsellor_clash_rows(
        self, filters: FilterParams, partner: Optional[str] = None, limit: int = 2000
    ) -> List[Dict[str, Any]]:
        """Only matched counsellor-clash leads (for Partner clash table)."""
        if not self.duck_repo.block_payment_exists() or not self._has_data():
            return []
        where, params = self._build_where(filters)
        block_clause = f"{'AND' if where else 'WHERE'} block_amount_paid"
        counsellor = self._counsellor_payment_expr("m.source_at_payment")
        partner_filter = ""
        query_params = list(params)
        if partner:
            partner_filter = "AND p.partner = ?"
            query_params.append(partner)
        query_params.append(limit)
        cte = self._matched_block_payment_cte(where, block_clause)
        rows = self.duck_repo.query_dicts(
            f"""
            {cte}
            SELECT
                p.prospect_id,
                p.partner,
                COALESCE(NULLIF(TRIM(p.name), ''), m.sheet_name) AS name,
                COALESCE(NULLIF(TRIM(p.email), ''), m.sheet_email) AS email,
                COALESCE(NULLIF(TRIM(CAST(p.phone AS VARCHAR)), ''), m.sheet_phone) AS phone,
                p.contact_source,
                m.source_at_payment,
                m.campaign_at_payment,
                m.college_code AS campus,
                'matched' AS match_status,
                m.match_method,
                TRUE AS is_clash
            FROM paid p
            INNER JOIN matches m ON p.prospect_id = m.prospect_id
            WHERE p.partner IS NOT NULL
              AND {counsellor}
              {partner_filter}
            ORDER BY p.prospect_id
            LIMIT ?
            """,
            query_params,
        )
        return rows

    def _build_block_payment_clashes(
        self, rows: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Partner-attributed block paid leads with Counsellor as payment source."""
        clash_rows = [
            r
            for r in rows
            if r.get("match_status") == "matched"
            and r.get("partner")
            and self._is_counsellor_payment_source(r.get("source_at_payment"))
        ]
        by_partner: Dict[str, int] = {}
        for r in clash_rows:
            partner = str(r.get("partner") or "Unknown")
            by_partner[partner] = by_partner.get(partner, 0) + 1
        return {
            "clash_count": len(clash_rows),
            "clash_rows": clash_rows,
            "clashes_by_partner": [
                {"partner": p, "count": c}
                for p, c in sorted(by_partner.items(), key=lambda x: x[1], reverse=True)
            ],
        }

    def _get_partner_counsellor_clashes(
        self, filters: FilterParams, partner: Optional[str] = None
    ) -> Dict[str, Any]:
        """Counsellor clashes from payment-sheet match (aggregate + clash rows only)."""
        empty = {
            "has_sheet": False,
            "total_clashes": 0,
            "by_partner": [],
            "rows": [],
        }
        if not self.duck_repo.block_payment_exists():
            return empty

        by_partner = self._counsellor_clash_counts_by_partner(filters, partner=partner)
        rows = self._counsellor_clash_rows(filters, partner=partner)
        total = sum(int(item["count"]) for item in by_partner)
        return {
            "has_sheet": True,
            "total_clashes": total,
            "by_partner": by_partner,
            "rows": rows,
        }

    def get_partner_counsellor_clashes(self, filters: FilterParams) -> Dict[str, Any]:
        return self._get_partner_counsellor_clashes(filters)

    def _partner_score(self, data: Dict[str, Any]) -> float:
        if not data:
            return 0
        leads = float(data.get("total_leads") or 1)
        admissions = float(data.get("admissions") or 0)
        block_paid = float(data.get("block_amount_paid") or 0)
        offer_letters = float(data.get("offer_letters") or 0)
        applications = float(data.get("applications") or 0)
        connected = float(data.get("connected") or 0)
        conversion = admissions / leads * 100
        pipeline = (block_paid * 4 + offer_letters * 2 + applications) / leads * 100
        engagement = connected / leads * 100
        revenue = float(data.get("revenue") or 0)
        return round(
            min(100, conversion * 0.35 + pipeline * 0.35 + engagement * 0.15 + min(revenue / 100000, 15)),
            2,
        )

    def search_leads(
        self, filters: FilterParams, page: int = 1, page_size: int = 50
    ) -> PaginatedResponse:
        if not self._has_data():
            return empty_search()

        where, params = self._build_where(filters)
        offset = (page - 1) * page_size
        total = int(
            self.duck_repo.execute_scalar(
                f"SELECT COUNT(*) FROM {MASTER_DATASET_TABLE} {where}", params
            )
            or 0
        )
        available = set(self.duck_repo.get_master_columns())
        optional_cols = [
            c
            for c in ("lead_age_days", "device", "last_activity_date")
            if c in available
        ]
        extra_select = (", " + ", ".join(optional_cols)) if optional_cols else ""
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT prospect_id, name, email, phone, partner, state, city,
                   lead_stage, contact_stage, funnel_stage, date, total_dialed_count,
                   connected, mql, sql, application, admission, revenue
                   {extra_select}
            FROM {MASTER_DATASET_TABLE}
            {where}
            ORDER BY date DESC NULLS LAST
            LIMIT ? OFFSET ?
            """,
            params + [page_size, offset],
        )
        return PaginatedResponse(
            items=rows,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=max(1, (total + page_size - 1) // page_size),
        )

    def get_alerts(self, filters: FilterParams) -> List[AlertItem]:
        if not self._has_data():
            return empty_alerts()

        alerts: List[AlertItem] = []
        now = datetime.utcnow()
        kpis = self.get_executive_kpis(filters)
        kpi_map = {k.key: k for k in kpis}

        def _kpi_drop(
            key: str,
            threshold: float,
            alert_type: str,
            title: str,
            severity: str = "warning",
        ) -> None:
            metric = kpi_map.get(key)
            if metric and metric.change_pct <= -threshold:
                alerts.append(
                    AlertItem(
                        alert_type=alert_type,
                        severity=severity,
                        title=title,
                        message=(
                            f"{metric.label} down {abs(metric.change_pct):.1f}% "
                            f"vs prior equal period "
                            f"({metric.previous:.0f} → {metric.current:.0f})"
                        ),
                        metric_value=metric.current,
                        threshold=metric.previous,
                        created_at=now,
                    )
                )

        contactability = kpi_map.get("contactability")
        if contactability and contactability.change_pct < -5:
            alerts.append(
                AlertItem(
                    alert_type="contactability_drop",
                    severity="warning",
                    title="Drop in Contactability",
                    message=f"Contactability dropped {abs(contactability.change_pct):.2f}%",
                    metric_value=contactability.current,
                    threshold=contactability.previous,
                    created_at=now,
                )
            )
        if contactability and contactability.current < 15:
            alerts.append(
                AlertItem(
                    alert_type="contactability_low",
                    severity="danger",
                    title="Contactability critically low",
                    message=f"Only {contactability.current:.1f}% of leads are contactable in this scope",
                    metric_value=contactability.current,
                    threshold=15.0,
                    created_at=now,
                )
            )

        admissions = kpi_map.get("admissions")
        if admissions and admissions.change_pct < -10:
            alerts.append(
                AlertItem(
                    alert_type="admissions_low",
                    severity="danger",
                    title="Admissions Low",
                    message=f"Admissions down {abs(admissions.change_pct):.2f}%",
                    metric_value=admissions.current,
                    created_at=now,
                )
            )

        _kpi_drop("block_amount_paid", 10, "block_amount_drop", "Block amount paid down")
        _kpi_drop("connected", 10, "connected_drop", "Connected leads down")
        _kpi_drop("mql", 10, "mql_drop", "MQL down")
        _kpi_drop("applications", 15, "applications_drop", "Applications down", "danger")
        _kpi_drop("offer_letters", 15, "offer_letter_drop", "Offer letters down")

        total_leads = kpi_map.get("total_leads")
        never_dialed = kpi_map.get("never_dialed")
        if total_leads and never_dialed and total_leads.current > 0:
            share = never_dialed.current / total_leads.current * 100
            if share >= 40:
                alerts.append(
                    AlertItem(
                        alert_type="never_dialed_high",
                        severity="warning",
                        title="High untouched share",
                        message=(
                            f"{share:.0f}% of leads ({never_dialed.current:.0f}) "
                            f"are still not touched / never dialed"
                        ),
                        metric_value=share,
                        threshold=40.0,
                        created_at=now,
                    )
                )

        dnp = kpi_map.get("dnp_pct")
        if dnp and dnp.current >= 35:
            alerts.append(
                AlertItem(
                    alert_type="dnp_high",
                    severity="warning",
                    title="High DNP rate",
                    message=f"DNP is {dnp.current:.1f}% in the current scope",
                    metric_value=dnp.current,
                    threshold=35.0,
                    created_at=now,
                )
            )

        block = kpi_map.get("block_amount_paid")
        if total_leads and block and total_leads.current >= 100:
            block_rate = block.current / total_leads.current * 100
            if block_rate < 0.5:
                alerts.append(
                    AlertItem(
                        alert_type="block_conversion_low",
                        severity="warning",
                        title="Low block conversion",
                        message=(
                            f"Only {block_rate:.2f}% of leads reached Block Amount Paid "
                            f"({block.current:.0f} / {total_leads.current:.0f})"
                        ),
                        metric_value=block_rate,
                        threshold=0.5,
                        created_at=now,
                    )
                )

        # Funnel: flag largest stage-to-stage drop when severe.
        funnel = self.get_funnel_data(filters)
        drops = (funnel.extra or {}).get("drops") or []
        if funnel.categories and drops:
            max_i = 1
            for i in range(1, len(drops)):
                if float(drops[i] or 0) > float(drops[max_i] or 0):
                    max_i = i
            max_drop = float(drops[max_i] or 0) if max_i < len(drops) else 0.0
            if max_drop >= 70 and max_i > 0:
                from_stage = funnel.categories[max_i - 1]
                to_stage = funnel.categories[max_i]
                alerts.append(
                    AlertItem(
                        alert_type="funnel_dropoff",
                        severity="warning",
                        title="Severe funnel drop-off",
                        message=(
                            f"{from_stage} → {to_stage}: {max_drop:.0f}% drop in current scope"
                        ),
                        metric_value=max_drop,
                        threshold=70.0,
                        created_at=now,
                    )
                )

        partners = self.get_partner_comparison(filters)
        if partners.series and partners.series[0].data:
            avg_leads = sum(partners.series[0].data) / len(partners.series[0].data)
            for i, partner in enumerate(partners.categories):
                leads = partners.series[0].data[i]
                if leads < avg_leads * 0.5:
                    alerts.append(
                        AlertItem(
                            alert_type="partner_down",
                            severity="warning",
                            title="Partner Down",
                            message=f"{partner} leads significantly below average",
                            metric_value=float(leads),
                            threshold=avg_leads,
                            created_at=now,
                        )
                    )

            block_totals = (partners.extra or {}).get("block_amount_total") or []
            zero_block = [
                str(partners.categories[i])
                for i, total in enumerate(block_totals)
                if int(total or 0) == 0
            ]
            if zero_block:
                sample = ", ".join(zero_block[:3])
                more = (
                    f" (+{len(zero_block) - 3} more)" if len(zero_block) > 3 else ""
                )
                alerts.append(
                    AlertItem(
                        alert_type="partner_zero_block",
                        severity="info",
                        title="Partners with zero block",
                        message=f"{len(zero_block)} partner(s) have no block amount paid: {sample}{more}",
                        metric_value=float(len(zero_block)),
                        created_at=now,
                    )
                )

        stats = self.get_dataset_stats()
        if stats["has_data"]:
            blank_rows = self.duck_repo.execute_scalar(
                f"SELECT COUNT(*) FROM {MASTER_DATASET_TABLE} WHERE prospect_id IS NULL OR prospect_id = ''"
            )
            if blank_rows and int(blank_rows) > 0:
                alerts.append(
                    AlertItem(
                        alert_type="missing_data",
                        severity="warning",
                        title="Missing Data",
                        message=f"{blank_rows} rows with blank Prospect IDs",
                        created_at=now,
                    )
                )

        total = stats["total_rows"]
        quality = 100.0
        if total > 0:
            issues = self.duck_repo.execute_scalar(
                f"""
                SELECT COUNT(*) FROM {MASTER_DATASET_TABLE}
                WHERE email IS NULL OR state IS NULL OR partner IS NULL
                """
            )
            quality = max(0, 100 - (int(issues or 0) / total * 100))

        alerts.append(
            AlertItem(
                alert_type="data_quality",
                severity="info" if quality > 90 else "warning",
                title="Data Quality Score",
                message=f"Overall data quality: {quality:.2f}%",
                metric_value=quality,
                created_at=now,
            )
        )

        # Merge richer anomaly signals into the same feed.
        for item in self.get_anomalies(filters):
            alerts.append(item)

        # Severity-first, then keep the feed readable.
        severity_rank = {"danger": 0, "warning": 1, "info": 2}
        alerts.sort(key=lambda a: (severity_rank.get(a.severity, 9), a.title))
        return alerts[:24]

    def _calendar_period_filters(
        self, filters: FilterParams, grain: str
    ) -> Tuple[FilterParams, FilterParams, str]:
        """Current vs prior calendar week/month windows (ignores custom date_from/to for grain)."""
        today = datetime.utcnow().date()
        data = filters.model_dump()
        if grain == "month":
            cur_start = today.replace(day=1)
            if cur_start.month == 1:
                prev_start = cur_start.replace(year=cur_start.year - 1, month=12)
            else:
                prev_start = cur_start.replace(month=cur_start.month - 1)
            prev_end = cur_start - timedelta(days=1)
            cur_end = today
            label = "month"
        else:
            # ISO week: Monday start
            cur_start = today - timedelta(days=today.weekday())
            cur_end = today
            prev_end = cur_start - timedelta(days=1)
            prev_start = prev_end - timedelta(days=6)
            label = "week"

        base = {
            k: v
            for k, v in data.items()
            if v is not None
            and k
            not in ("date_from", "date_to", "month", "year", "week", "quarter")
        }
        current = FilterParams(
            **{
                **base,
                "date_from": cur_start.strftime("%Y-%m-%d"),
                "date_to": cur_end.strftime("%Y-%m-%d"),
            }
        )
        previous = FilterParams(
            **{
                **base,
                "date_from": prev_start.strftime("%Y-%m-%d"),
                "date_to": prev_end.strftime("%Y-%m-%d"),
            }
        )
        return current, previous, label

    def _kpi_snapshot(self, filters: FilterParams) -> Dict[str, float]:
        """Lightweight counts for period compare (no nested prior window / trends)."""
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())

        def flag(col: str) -> str:
            return (
                f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END)"
                if col in available
                else "0"
            )

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                COUNT(*) AS total_leads,
                {flag("connected")} AS connected,
                {flag("mql")} AS mql,
                {flag("application")} AS applications,
                {flag("block_amount_paid")} AS block_amount_paid,
                {flag("admission")} AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            """,
            params,
        )
        cur = rows[0] if rows else {}
        total = float(cur.get("total_leads") or 0)
        connected = float(cur.get("connected") or 0)
        return {
            "total_leads": total,
            "connected": connected,
            "mql": float(cur.get("mql") or 0),
            "applications": float(cur.get("applications") or 0),
            "block_amount_paid": float(cur.get("block_amount_paid") or 0),
            "admissions": float(cur.get("admissions") or 0),
            "contactability": (connected / total * 100.0) if total else 0.0,
        }

    def get_period_compare(
        self, filters: FilterParams, grain: str = "week"
    ) -> Dict[str, Any]:
        if not self._has_data():
            return {"grain": grain, "kpis": [], "funnel_rates": []}

        grain = "month" if grain == "month" else "week"
        current_f, previous_f, label = self._calendar_period_filters(filters, grain)
        cur = self._kpi_snapshot(current_f)
        prev = self._kpi_snapshot(previous_f)

        labels = {
            "total_leads": "Total Leads",
            "connected": "Connected",
            "mql": "MQL",
            "applications": "Applications",
            "block_amount_paid": "Block Amount Paid",
            "admissions": "Admissions",
            "contactability": "Contactability %",
        }
        out_kpis: List[Dict[str, Any]] = []
        for key, label_txt in labels.items():
            cur_val = float(cur.get(key) or 0)
            prev_val = float(prev.get(key) or 0)
            change = (
                round((cur_val - prev_val) / prev_val * 100, 2) if prev_val else 0.0
            )
            out_kpis.append(
                {
                    "key": key,
                    "label": label_txt,
                    "current": cur_val,
                    "previous": prev_val,
                    "change_pct": change,
                }
            )

        return {
            "grain": label,
            "current_from": current_f.date_from,
            "current_to": current_f.date_to,
            "previous_from": previous_f.date_from,
            "previous_to": previous_f.date_to,
            "kpis": out_kpis,
            "funnel_rates": [],
        }

    def get_funnel_trends(self, filters: FilterParams) -> ChartData:
        if not self._has_data():
            return empty_chart("funnel_trends", "line", "Funnel Conversion Trends")

        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        stage_cols = [
            ("connected", "Connected"),
            ("mql", "MQL"),
            ("application", "Application"),
            ("block_amount_paid", "Block Amount"),
            ("admission", "Admission"),
        ]
        select_parts = ["month", "COUNT(*) AS leads"]
        for col, _label in stage_cols:
            if col in available:
                select_parts.append(
                    f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END) AS {col}"
                )
            else:
                select_parts.append(f"0 AS {col}")

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT {', '.join(select_parts)}
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} month IS NOT NULL AND TRIM(CAST(month AS VARCHAR)) <> ''
            GROUP BY month
            ORDER BY month
            """,
            params,
        )

        categories = [str(r["month"]) for r in rows]
        series: List[ChartSeries] = []
        for col, label in stage_cols:
            rates: List[float] = []
            for r in rows:
                leads = int(r.get("leads") or 0)
                cnt = int(r.get(col) or 0)
                rates.append(round(cnt / leads * 100, 2) if leads else 0.0)
            series.append(ChartSeries(name=f"{label} %", data=rates))

        return ChartData(
            chart_id="funnel_trends",
            chart_type="line",
            title="Monthly Funnel Conversion % (of leads)",
            categories=categories,
            series=series,
        )

    def get_conversion_rates(self, filters: FilterParams) -> Dict[str, Any]:
        if not self._has_data():
            return {"by_partner": [], "by_campaign": []}

        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())

        def flag(col: str) -> str:
            return (
                f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END)"
                if col in available
                else "0"
            )

        partner_rows = self.duck_repo.query_dicts(
            f"""
            SELECT partner,
                   COUNT(*) AS leads,
                   {flag("connected")} AS connected,
                   {flag("mql")} AS mql,
                   {flag("application")} AS applications,
                   {flag("block_amount_paid")} AS block_amount_paid,
                   {flag("admission")} AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} partner IS NOT NULL
            GROUP BY partner
            ORDER BY leads DESC
            """,
            params,
        )

        def rate(n: int, d: int) -> float:
            return round(n / d * 100, 2) if d else 0.0

        by_partner = []
        for r in partner_rows:
            leads = int(r.get("leads") or 0)
            block = int(r.get("block_amount_paid") or 0)
            adm = int(r.get("admissions") or 0)
            by_partner.append(
                {
                    "partner": r.get("partner"),
                    "leads": leads,
                    "connected": int(r.get("connected") or 0),
                    "mql": int(r.get("mql") or 0),
                    "applications": int(r.get("applications") or 0),
                    "block_amount_paid": block,
                    "admissions": adm,
                    "lead_to_block_pct": rate(block, leads),
                    "lead_to_admission_pct": rate(adm, leads),
                    "connected_pct": rate(int(r.get("connected") or 0), leads),
                }
            )

        campaign_select = "COALESCE(campaign, '(blank)') AS campaign"
        if "campaign" not in available:
            return {"by_partner": by_partner, "by_campaign": []}

        campaign_rows = self.duck_repo.query_dicts(
            f"""
            SELECT {campaign_select},
                   COALESCE(partner, '(blank)') AS partner,
                   COUNT(*) AS leads,
                   {flag("block_amount_paid")} AS block_amount_paid,
                   {flag("admission")} AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY campaign, partner
            ORDER BY leads DESC
            LIMIT 40
            """,
            params,
        )
        by_campaign = []
        for r in campaign_rows:
            leads = int(r.get("leads") or 0)
            block = int(r.get("block_amount_paid") or 0)
            adm = int(r.get("admissions") or 0)
            by_campaign.append(
                {
                    "campaign": r.get("campaign"),
                    "partner": r.get("partner"),
                    "leads": leads,
                    "block_amount_paid": block,
                    "admissions": adm,
                    "lead_to_block_pct": rate(block, leads),
                    "lead_to_admission_pct": rate(adm, leads),
                }
            )

        return {"by_partner": by_partner, "by_campaign": by_campaign}

    def get_cohorts(
        self, filters: FilterParams, by: str = "month"
    ) -> Dict[str, Any]:
        if not self._has_data():
            return {"by": by, "cohorts": []}

        grain = "week" if by == "week" else "month"
        group_col = "week" if grain == "week" else "month"
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        age_expr = (
            "AVG(lead_age_days)" if "lead_age_days" in available else "NULL"
        )

        def flag(col: str) -> str:
            return (
                f"SUM(CASE WHEN {col} THEN 1 ELSE 0 END)"
                if col in available
                else "0"
            )

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT {group_col} AS cohort,
                   COUNT(*) AS leads,
                   {age_expr} AS avg_age_days,
                   {flag("connected")} AS connected,
                   {flag("mql")} AS mql,
                   {flag("block_amount_paid")} AS block_amount_paid,
                   {flag("admission")} AS admissions
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} {group_col} IS NOT NULL
              AND TRIM(CAST({group_col} AS VARCHAR)) <> ''
            GROUP BY {group_col}
            ORDER BY {group_col} DESC
            LIMIT 24
            """,
            params,
        )

        cohorts = []
        for r in rows:
            leads = int(r.get("leads") or 0)
            block = int(r.get("block_amount_paid") or 0)
            connected = int(r.get("connected") or 0)
            cohorts.append(
                {
                    "cohort": str(r.get("cohort")),
                    "leads": leads,
                    "avg_age_days": (
                        round(float(r["avg_age_days"]), 1)
                        if r.get("avg_age_days") is not None
                        else None
                    ),
                    "connected": connected,
                    "connected_pct": round(connected / leads * 100, 2) if leads else 0,
                    "mql": int(r.get("mql") or 0),
                    "block_amount_paid": block,
                    "block_pct": round(block / leads * 100, 2) if leads else 0,
                    "admissions": int(r.get("admissions") or 0),
                }
            )

        return {"by": grain, "cohorts": cohorts}

    def get_block_payment_attribution(
        self, filters: FilterParams
    ) -> Dict[str, Any]:
        """Aggregate payment-sheet UTMs / coupon / campus (no master date filters)."""
        try:
            n = int(
                self.duck_repo.execute_scalar(
                    f"SELECT COUNT(*) FROM {BLOCK_PAYMENT_TABLE}"
                )
                or 0
            )
        except Exception:
            n = 0
        if n <= 0:
            return {
                "has_sheet": False,
                "row_count": 0,
                "by_source_at_payment": [],
                "by_campaign_at_payment": [],
                "by_coupon": [],
                "by_college": [],
                "by_original_utm_campaign": [],
            }

        def top(col: str, limit: int = 15) -> List[Dict[str, Any]]:
            try:
                rows = self.duck_repo.query_dicts(
                    f"""
                    SELECT COALESCE(NULLIF(TRIM(CAST({col} AS VARCHAR)), ''), '(blank)') AS label,
                           COUNT(*) AS cnt
                    FROM {BLOCK_PAYMENT_TABLE}
                    GROUP BY 1
                    ORDER BY cnt DESC
                    LIMIT ?
                    """,
                    [limit],
                )
            except Exception:
                return []
            return [
                {"label": r.get("label"), "count": int(r.get("cnt") or 0)}
                for r in rows
            ]

        return {
            "has_sheet": True,
            "row_count": n,
            "by_source_at_payment": top("source_at_payment"),
            "by_campaign_at_payment": top("campaign_at_payment"),
            "by_coupon": top("coupon_code_used"),
            "by_college": top("college_name"),
            "by_original_utm_campaign": top("original_utm_campaign"),
        }

    def get_anomalies(self, filters: FilterParams) -> List[AlertItem]:
        """Weekly partner lead / contactability swings beyond simple MoM thresholds."""
        if not self._has_data():
            return []

        alerts: List[AlertItem] = []
        now = datetime.utcnow()
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        if "week" not in available:
            return alerts

        rows = self.duck_repo.query_dicts(
            f"""
            SELECT partner, week, COUNT(*) AS leads,
                   SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS connected
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} partner IS NOT NULL AND week IS NOT NULL
            GROUP BY partner, week
            ORDER BY partner, week
            """,
            params,
        )
        by_partner: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            by_partner.setdefault(str(r["partner"]), []).append(r)

        for partner, series in by_partner.items():
            if len(series) < 4:
                continue
            leads = [int(x.get("leads") or 0) for x in series]
            mean = sum(leads[:-1]) / max(1, len(leads) - 1)
            if mean <= 0:
                continue
            latest = leads[-1]
            # Flag when latest week is <50% or >200% of trailing mean.
            if latest < mean * 0.5:
                alerts.append(
                    AlertItem(
                        alert_type="anomaly_partner_leads_low",
                        severity="warning",
                        title=f"{partner}: low weekly leads",
                        message=(
                            f"Latest week {latest} vs avg {mean:.0f} "
                            f"({(latest / mean - 1) * 100:.0f}%)"
                        ),
                        metric_value=float(latest),
                        threshold=mean,
                        created_at=now,
                    )
                )
            elif latest > mean * 2:
                alerts.append(
                    AlertItem(
                        alert_type="anomaly_partner_leads_high",
                        severity="info",
                        title=f"{partner}: spike in weekly leads",
                        message=(
                            f"Latest week {latest} vs avg {mean:.0f} "
                            f"(+{(latest / mean - 1) * 100:.0f}%)"
                        ),
                        metric_value=float(latest),
                        threshold=mean,
                        created_at=now,
                    )
                )

            contact = []
            for x in series:
                L = int(x.get("leads") or 0)
                C = int(x.get("connected") or 0)
                contact.append((C / L * 100) if L else 0.0)
            if len(contact) >= 4:
                c_mean = sum(contact[:-1]) / (len(contact) - 1)
                c_latest = contact[-1]
                if c_mean > 5 and c_latest < c_mean - 15:
                    alerts.append(
                        AlertItem(
                            alert_type="anomaly_contactability",
                            severity="warning",
                            title=f"{partner}: contactability dip",
                            message=(
                                f"Weekly contactability {c_latest:.1f}% "
                                f"vs avg {c_mean:.1f}%"
                            ),
                            metric_value=c_latest,
                            threshold=c_mean,
                            created_at=now,
                        )
                    )

        return alerts[:12]

    def get_goals(self, filters: FilterParams) -> Dict[str, Any]:
        """Breakeven block targets from PARTNER_COMMERCIALS vs actual Block ROI."""
        import math

        revenue = self.get_revenue_dashboard(filters)
        partners_out = []
        for p in revenue.get("partners") or []:
            if p.get("cost") is None:
                continue
            advance = float(p.get("advance") or 0)
            incentive = float(p.get("incentive_per_admission") or 0)
            advance_only = bool(p.get("advance_only"))
            block_roi = int(p.get("block_amount_roi") or 0)
            rev_per = float(
                p.get("revenue_per_admission") or self.REVENUE_PER_ADMISSION_INR
            )
            if advance_only or incentive <= 0:
                # Advance recovered when revenue covers advance.
                contribution = rev_per
                target_blocks = (
                    int(math.ceil(advance / contribution)) if contribution > 0 else 0
                )
            else:
                contribution = rev_per - incentive
                target_blocks = (
                    int(math.ceil(advance / contribution)) if contribution > 0 else 0
                )
            progress = (
                round(block_roi / target_blocks * 100, 1) if target_blocks else 100.0
            )
            partners_out.append(
                {
                    "partner": p.get("partner"),
                    "block_roi": block_roi,
                    "target_blocks": target_blocks,
                    "progress_pct": min(progress, 999.0),
                    "gap_blocks": max(0, target_blocks - block_roi),
                    "status": p.get("status"),
                }
            )

        return {
            "partners": partners_out,
            "totals": {
                "on_track": sum(1 for p in partners_out if p["gap_blocks"] <= 0),
                "behind": sum(1 for p in partners_out if p["gap_blocks"] > 0),
            },
        }

    def get_heatmap_data(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT
                EXTRACT(DOW FROM CAST(date AS DATE)) AS dow,
                EXTRACT(HOUR FROM CAST(date AS TIMESTAMP)) AS hour,
                COUNT(*) AS cnt
            FROM {MASTER_DATASET_TABLE}
            {where}
            {"AND" if where else "WHERE"} date IS NOT NULL
            GROUP BY dow, hour
            """,
            params,
        )
        return ChartData(
            chart_id="heatmap",
            chart_type="heatmap",
            title="Lead Activity Heatmap",
            extra={"data": rows},
        )

    def get_lead_sources(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT COALESCE(partner, 'Unknown') AS partner, COUNT(*) AS cnt
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY partner ORDER BY cnt DESC
            """,
            params,
        )
        return ChartData(
            chart_id="lead_sources",
            chart_type="donut",
            title="Leads by Partner",
            categories=[r["partner"] for r in rows],
            series=[ChartSeries(name="Leads", data=[int(r["cnt"]) for r in rows])],
        )

    def get_call_distribution(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT {SAFE_DIALS_EXPR} AS dials, COUNT(*) AS cnt
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY dials
            ORDER BY dials
            LIMIT 25
            """,
            params,
        )
        return ChartData(
            chart_id="call_distribution",
            chart_type="bar",
            title="Call Distribution",
            categories=[str(r["dials"]) for r in rows],
            series=[ChartSeries(name="Leads", data=[int(r["cnt"]) for r in rows])],
        )

    def get_contactability_trend(self, filters: FilterParams) -> ChartData:
        where, params = self._build_where(filters)
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT month,
                   SUM(CASE WHEN connected THEN 1 ELSE 0 END) AS contactable,
                   COUNT(*) AS total
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY month ORDER BY month
            """,
            params,
        )
        rates = [
            round(int(r["contactable"]) / int(r["total"]) * 100, 2) if r["total"] else 0
            for r in rows
        ]
        return ChartData(
            chart_id="contactability_trend",
            chart_type="line",
            title="Contactability Trend",
            categories=[r["month"] for r in rows],
            series=[ChartSeries(name="Contactability %", data=rates)],
        )

    def get_metric_trends(self, filters: FilterParams) -> Dict[str, ChartData]:
        """Monthly trends for Overview selectable chart (leads / test / persona / block)."""
        where, params = self._build_where(filters)
        available = set(self.duck_repo.get_master_columns())
        btech_persona = (
            "REPLACE(LOWER(REPLACE(TRIM(COALESCE(persona, '')), '.', '')), ' ', '') "
            "= 'knowmoreaboutbtech'"
        )
        test_expr = (
            "SUM(CASE WHEN test_registration THEN 1 ELSE 0 END)"
            if "test_registration" in available
            else "0"
        )
        block_expr = (
            "SUM(CASE WHEN block_amount_paid THEN 1 ELSE 0 END)"
            if "block_amount_paid" in available
            else "0"
        )
        persona_expr = (
            f"SUM(CASE WHEN {btech_persona} THEN 1 ELSE 0 END)"
            if "persona" in available
            else "0"
        )
        rows = self.duck_repo.query_dicts(
            f"""
            SELECT month AS period,
                   COUNT(*) AS leads,
                   {test_expr} AS test_takers,
                   {persona_expr} AS know_more_btech,
                   {block_expr} AS block_amount
            FROM {MASTER_DATASET_TABLE}
            {where}
            GROUP BY month
            ORDER BY period
            """,
            params,
        )
        categories = [str(r["period"]) for r in rows]

        def _line(chart_id: str, title: str, series_name: str, key: str) -> ChartData:
            return ChartData(
                chart_id=chart_id,
                chart_type="line",
                title=title,
                categories=categories,
                series=[
                    ChartSeries(
                        name=series_name,
                        data=[int(r.get(key) or 0) for r in rows],
                    )
                ],
            )

        return {
            "leads_trend": _line("leads_trend", "Leads Trend", "Leads", "leads"),
            "test_taker_trend": _line(
                "test_taker_trend", "Test Taker Trend", "Test Takers", "test_takers"
            ),
            "persona_know_more_trend": _line(
                "persona_know_more_trend",
                "Know More about B.Tech Trend",
                "Know More about B.Tech",
                "know_more_btech",
            ),
            "block_amount_trend": _line(
                "block_amount_trend",
                "Block Amount Trend",
                "Block Amount Paid",
                "block_amount",
            ),
        }

    def export_data(self, filters: FilterParams, limit: int = 100000) -> List[Dict[str, Any]]:
        where, params = self._build_where(filters)
        return self.duck_repo.query_dicts(
            f"SELECT * FROM {MASTER_DATASET_TABLE} {where} LIMIT ?",
            params + [limit],
        )

    def get_block_payment_backtracking(self, filters: FilterParams) -> Dict[str, Any]:
        """Match block-amount-paid leads in MASTER_DATASET to the uploaded payment sheet."""
        if not self._has_data():
            return {
                "has_sheet": False,
                "sheet_row_count": 0,
                "total_block_paid": 0,
                "matched_count": 0,
                "unmatched_count": 0,
                "counsellor_count": 0,
                "clash_count": 0,
                "clashes_by_partner": [],
                "clash_rows": [],
                "rows": [],
                "state_summary": [],
            }

        sheet_status = self.duck_repo.block_payment_exists()
        where, params = self._build_where(filters)
        block_clause = f"{'AND' if where else 'WHERE'} block_amount_paid"

        total_row = self.duck_repo.query_dicts(
            f"SELECT COUNT(*) AS cnt FROM {MASTER_DATASET_TABLE} {where} {block_clause}",
            params,
        )
        total_block_paid = int(total_row[0]["cnt"]) if total_row else 0

        state_rows = self.duck_repo.query_dicts(
            f"""
            SELECT state, COUNT(*) AS leads
            FROM {MASTER_DATASET_TABLE}
            {where}
            {block_clause}
            AND state IS NOT NULL AND TRIM(CAST(state AS VARCHAR)) <> ''
            GROUP BY state
            ORDER BY leads DESC
            """,
            params,
        )
        state_summary = [
            {
                "state": r["state"],
                "leads": int(r["leads"] or 0),
                "admissions": 0,
                "stages": {"Block Amount Paid": int(r["leads"] or 0)},
            }
            for r in state_rows
        ]

        if not sheet_status:
            unpaid_rows = self.duck_repo.query_dicts(
                f"""
                SELECT prospect_id, name, email, phone, partner, source AS contact_source
                FROM {MASTER_DATASET_TABLE}
                {where}
                {block_clause}
                ORDER BY date DESC NULLS LAST
                LIMIT 2000
                """,
                params,
            )
            rows = [
                {
                    "prospect_id": r.get("prospect_id"),
                    "name": r.get("name"),
                    "email": r.get("email"),
                    "phone": r.get("phone"),
                    "partner": r.get("partner"),
                    "contact_source": r.get("contact_source"),
                    "source_at_payment": None,
                    "campaign_at_payment": None,
                    "campus": None,
                    "match_status": "no_sheet",
                    "match_method": None,
                    "is_clash": False,
                }
                for r in unpaid_rows
            ]
            return {
                "has_sheet": False,
                "sheet_row_count": 0,
                "total_block_paid": total_block_paid,
                "matched_count": 0,
                "unmatched_count": total_block_paid,
                "counsellor_count": 0,
                "clash_count": 0,
                "clashes_by_partner": [],
                "clash_rows": [],
                "rows": rows,
                "state_summary": state_summary,
            }

        sheet_count_row = self.duck_repo.query_dicts(
            f"SELECT COUNT(*) AS cnt FROM {BLOCK_PAYMENT_TABLE}"
        )
        sheet_row_count = int(sheet_count_row[0]["cnt"]) if sheet_count_row else 0

        rows = self.duck_repo.query_dicts(
            f"""
            WITH paid AS (
                SELECT
                    prospect_id,
                    name,
                    email,
                    phone,
                    partner,
                    source AS contact_source,
                    LOWER(TRIM(COALESCE(email, ''))) AS norm_email,
                    regexp_replace(COALESCE(CAST(phone AS VARCHAR), ''), '[^0-9]', '', 'g') AS norm_phone
                FROM {MASTER_DATASET_TABLE}
                {where}
                {block_clause}
            ),
            email_match AS (
                SELECT
                    p.prospect_id,
                    s.source_at_payment,
                    s.campaign_at_payment,
                    s.college_code,
                    s.full_name AS sheet_name,
                    s.email AS sheet_email,
                    s.phone AS sheet_phone,
                    'email' AS match_method
                FROM paid p
                INNER JOIN {BLOCK_PAYMENT_TABLE} s
                    ON p.norm_email = s.match_email
                WHERE p.norm_email <> '' AND s.match_email IS NOT NULL
            ),
            phone_match AS (
                SELECT
                    p.prospect_id,
                    s.source_at_payment,
                    s.campaign_at_payment,
                    s.college_code,
                    s.full_name AS sheet_name,
                    s.email AS sheet_email,
                    s.phone AS sheet_phone,
                    'phone' AS match_method
                FROM paid p
                INNER JOIN {BLOCK_PAYMENT_TABLE} s
                    ON p.norm_phone = s.match_phone
                WHERE p.prospect_id NOT IN (SELECT prospect_id FROM email_match)
                  AND p.norm_phone <> ''
                  AND LENGTH(p.norm_phone) >= 10
                  AND s.match_phone IS NOT NULL
            ),
            matches AS (
                SELECT * FROM email_match
                UNION ALL
                SELECT * FROM phone_match
            )
            SELECT
                p.prospect_id,
                p.partner,
                COALESCE(NULLIF(TRIM(p.name), ''), m.sheet_name) AS name,
                COALESCE(NULLIF(TRIM(p.email), ''), m.sheet_email) AS email,
                COALESCE(NULLIF(TRIM(CAST(p.phone AS VARCHAR)), ''), m.sheet_phone) AS phone,
                p.contact_source,
                m.source_at_payment,
                m.campaign_at_payment,
                m.college_code AS campus,
                CASE WHEN m.prospect_id IS NOT NULL THEN 'matched' ELSE 'unmatched' END AS match_status,
                m.match_method
            FROM paid p
            LEFT JOIN matches m ON p.prospect_id = m.prospect_id
            ORDER BY match_status DESC, p.prospect_id
            LIMIT 2000
            """,
            params,
        )

        matched_count = sum(1 for r in rows if r.get("match_status") == "matched")
        counsellor_count = sum(
            1
            for r in rows
            if r.get("match_status") == "matched"
            and self._is_counsellor_payment_source(r.get("source_at_payment"))
        )
        clashes = self._build_block_payment_clashes(rows)
        clash_rows = clashes["clash_rows"]
        clash_ids = {r.get("prospect_id") for r in clash_rows}
        for r in rows:
            r["is_clash"] = r.get("prospect_id") in clash_ids
        return {
            "has_sheet": True,
            "sheet_row_count": sheet_row_count,
            "total_block_paid": total_block_paid,
            "matched_count": matched_count,
            "unmatched_count": total_block_paid - matched_count,
            "counsellor_count": counsellor_count,
            "clash_count": clashes["clash_count"],
            "clashes_by_partner": clashes["clashes_by_partner"],
            "clash_rows": clash_rows,
            "rows": rows,
            "state_summary": state_summary,
        }
