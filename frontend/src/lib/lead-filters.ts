/** Maps KPI / bucket / AI metric keys to backend lead_filter query values. */
export const KPI_LEAD_FILTERS: Record<string, string | undefined> = {
  total_leads: undefined,
  connected: 'connected',
  ai_connected: 'ai_connected',
  ac_connected: 'ac_connected',
  mql: 'mql',
  sql: 'sql',
  applications: 'applications',
  test_registrations: 'test_registrations',
  offer_letters: 'offer_letters',
  interview: 'interview',
  block_amount_paid: 'block_amount_paid',
  admissions: 'admissions',
  contactability: 'connected',
  never_dialed: 'never_dialed',
  avg_dial_count: 'avg_dial_count',
  ai_calls: 'ai_calls',
  dnp_pct: 'dnp_pct',
};

export const BUCKET_LEAD_FILTERS: Record<string, string> = {
  'AI Bot Dialed': 'bucket_ai_bot_dialed',
  'Leads not Touched': 'bucket_leads_not_touched',
  '1 Dial': 'bucket_1_dial',
  '2 Dial': 'bucket_2_dial',
  '3+ Dial': 'bucket_3_plus_dial',
};

export const AI_LEAD_FILTERS: Record<string, string> = {
  calls: 'ai_calls',
  qualified: 'ai_qualified',
  warm: 'ai_warm',
  high_intent: 'ai_high_intent',
  payment_link: 'ai_payment_link',
  brochure: 'ai_brochure',
  dnp: 'ai_dnp',
  interested: 'ai_interested',
  callback: 'ai_callback',
};
