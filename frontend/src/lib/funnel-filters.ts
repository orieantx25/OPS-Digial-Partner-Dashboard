/** Map funnel stage labels to lead_filter keys for Lead Explorer. */
export const FUNNEL_STAGE_LEAD_FILTERS: Record<string, string | undefined> = {
  Lead: undefined,
  Connected: 'connected',
  MQL: 'mql',
  SQL: 'sql',
  Application: 'applications',
  'Test Registration': 'test_registrations',
  Interview: 'interview',
  'Offer Letter': 'offer_letters',
  'Block Amount Paid': 'block_amount_paid',
  Admission: 'admissions',
};
