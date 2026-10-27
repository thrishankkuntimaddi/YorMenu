/** SQLite datetime('now') strings are UTC. */
export function parseDbTime(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z');
}
export function fmtDateTime(tz: string, s: string | Date): string {
  const d = typeof s === 'string' ? parseDbTime(s) : s;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
