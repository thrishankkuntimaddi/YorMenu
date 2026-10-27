/** Licences and safety certificates an Indian restaurant is usually asked for. */
export const DOC_TYPES = [
  { key: 'fssai', label: 'FSSAI food licence / registration', required: true, hint: '14-digit licence number. Must be displayed at the premises.' },
  { key: 'gst', label: 'GST registration certificate', required: false, hint: 'Needed if turnover is above the GST limit. Number goes on every bill.' },
  { key: 'trade', label: 'Trade licence (municipality)', required: true, hint: 'From your municipal corporation / gram panchayat. Renew every year.' },
  { key: 'shop', label: 'Shop & Establishment registration', required: true, hint: 'Labour department registration for the business and staff.' },
  { key: 'fire', label: 'Fire safety NOC', required: true, hint: 'Fire department No Objection Certificate. Check extinguishers are in date.' },
  { key: 'health', label: 'Health / eating house licence', required: false, hint: 'Some cities issue this separately from the police or health department.' },
  { key: 'pollution', label: 'Pollution control consent (CTE / CTO)', required: false, hint: 'State pollution control board, for bigger kitchens.' },
  { key: 'water', label: 'Water quality test report', required: false, hint: 'Drinking water test from an NABL lab, usually every 6 months.' },
  { key: 'pest', label: 'Pest control certificate', required: false, hint: 'From your pest control agency after each service.' },
  { key: 'medical', label: 'Staff medical fitness certificates', required: false, hint: 'FSSAI asks for yearly medical fitness for food handlers.' },
  { key: 'liquor', label: 'Liquor licence', required: false, hint: 'Only if you serve alcohol.' },
  { key: 'signage', label: 'Signage / hoarding licence', required: false, hint: 'For the board outside, in some cities.' },
  { key: 'electrical', label: 'Electrical / LPG safety certificate', required: false, hint: 'Gas pipeline and wiring inspection.' },
  { key: 'other', label: 'Other document', required: false, hint: '' },
] as const;

export type DocType = (typeof DOC_TYPES)[number]['key'];
export const DOC_KEYS = DOC_TYPES.map((d) => d.key) as [DocType, ...DocType[]];

const DAY = 86_400_000;

/** verified / pending / rejected, plus expired or expiring (within 30 days) by date. */
export function docState(d: { status: string; expires_on: string | null }, today = new Date().toISOString().slice(0, 10)) {
  if (d.expires_on && d.expires_on < today) return 'expired';
  if (d.status !== 'verified') return d.status;
  if (d.expires_on && new Date(d.expires_on).getTime() - new Date(today).getTime() <= 30 * DAY) return 'expiring';
  return 'verified';
}

/** One line per required type plus every uploaded document, newest first. */
export function complianceOverview(docs: { doc_type: string; status: string; expires_on: string | null }[]) {
  const today = new Date().toISOString().slice(0, 10);
  const counts = { verified: 0, pending: 0, rejected: 0, expired: 0, expiring: 0, missing: 0 };
  for (const d of docs) counts[docState(d, today) as keyof typeof counts]++;
  for (const t of DOC_TYPES) if (t.required && !docs.some((d) => d.doc_type === t.key && docState(d, today) !== 'rejected')) counts.missing++;
  return counts;
}
