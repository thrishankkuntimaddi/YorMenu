import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, useAction, useLoad } from '../ui';
import type { Settings as S } from '../types';
import { LANGS } from '../i18n';

const COLOURS: [string, string][] = [
  ['#b91c1c', 'Red'], ['#c2410c', 'Orange'], ['#a16207', 'Mustard'], ['#15803d', 'Green'], ['#0f766e', 'Teal'],
  ['#1d4ed8', 'Blue'], ['#6d28d9', 'Purple'], ['#be185d', 'Pink'], ['#7c2d12', 'Brown'], ['#1f2937', 'Charcoal'],
];

/** What each GST choice puts on the bill (India). */
const GST_PRESETS: Partial<Record<S['gstType'], Partial<S>>> = {
  regular5: { taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }] },
  regular18: { taxes: [{ name: 'CGST', rate: 9 }, { name: 'SGST', rate: 9 }] },
  composition: { taxes: [], taxMode: 'none' },
  unregistered: { taxes: [], taxMode: 'none' },
};
const GST_HELP: Record<S['gstType'], string> = {
  regular5: 'Bills say TAX INVOICE with your GSTIN and CGST 2.5% + SGST 2.5% (no input tax credit). SAC 996331.',
  regular18: 'Bills say TAX INVOICE with your GSTIN and CGST 9% + SGST 9%. SAC 996331.',
  composition: 'Bills say BILL OF SUPPLY and "Composition taxable person, not eligible to collect tax on supplies". No GST is charged.',
  unregistered: 'No GST is charged and no GSTIN is printed.',
  custom: 'Set your own tax lines below (for example UTGST in a union territory).',
};

type Data = { name: string; address: string; phone: string; gstin: string; settings: S };

export default function Settings() {
  const { refresh } = useSession();
  const { data, error } = useLoad(() => api.get<Data>('/settings'));
  const [f, setF] = useState<Data | null>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading error={error} />;
  const s = f.settings;
  const set = (patch: Partial<S>) => setF({ ...f, settings: { ...s, ...patch } });
  const save = () => run(async () => { await api.put('/settings', f); await refresh(); }, 'Settings saved');
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>Settings</h1><button className="btn primary" disabled={busy} onClick={save}>Save changes</button></div>
      <div className="stack lg">
        <div className="card pad stack">
          <h2>Restaurant (printed on the bill)</h2>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <div className="grid2">
            <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label>GSTIN<input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /></label>
          </div>
          <label>Bill footer<input value={s.billFooter} onChange={(e) => set({ billFooter: e.target.value })} /></label>
          <label>Bill number prefix (optional)<input value={s.billPrefix} onChange={(e) => set({ billPrefix: e.target.value })} placeholder="e.g. AD-" /></label>
        </div>

        <div className="card pad stack">
          <h2>Look & language</h2>
          <label>Restaurant colour (buttons, bills and reports)</label>
          <div className="swatches">
            {COLOURS.map(([c, name]) => <button key={c} title={name} aria-label={name} className={s.brandColor === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ brandColor: c })} />)}
            <input type="color" aria-label="Custom colour" value={s.brandColor} onChange={(e) => set({ brandColor: e.target.value })} style={{ width: 48, padding: 2 }} />
          </div>
          <label>Default language for staff screens (each person can change their own under More)
            <select value={s.language} onChange={(e) => set({ language: e.target.value as S['language'] })}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </label>
        </div>

        <div className="card pad stack">
          <h2>Privacy & security</h2>
          <label>Log a phone out automatically when not used for
            <select value={s.idleLogoutMinutes} onChange={(e) => set({ idleLogoutMinutes: Number(e.target.value) })}>
              <option value={0}>Never</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option>
              <option value={60}>1 hour</option><option value={240}>4 hours</option><option value={720}>12 hours</option>
            </select>
          </label>
          <div className="small muted">Who can see customer phone numbers, give discounts or download reports is set in <a href="/admin/permissions">Permissions</a>.</div>
        </div>

        <div className="card pad stack">
          <h2>Tax & charges</h2>
          <label>GST registration
            <select value={s.gstType} onChange={(e) => {
              const g = e.target.value as S['gstType'];
              const preset = GST_PRESETS[g];
              set(preset ? { gstType: g, ...preset, taxMode: preset.taxMode ?? (s.taxMode === 'none' ? 'exclusive' : s.taxMode) } : { gstType: g });
            }}>
              <option value="regular5">Regular GST, 5% (most restaurants)</option>
              <option value="regular18">Regular GST, 18% (inside a hotel with room rent above ₹7,500)</option>
              <option value="composition">Composition scheme (no GST on bills)</option>
              <option value="unregistered">Not registered for GST</option>
              <option value="custom">Custom taxes</option>
            </select>
          </label>
          <div className="small muted">{GST_HELP[s.gstType]}</div>
          {['regular5', 'regular18', 'composition'].includes(s.gstType) && !f.gstin.trim() && <div className="err">Enter your GSTIN above. It must be printed on GST bills.</div>}
          <label>Prices on the menu are
            <select value={s.taxMode} onChange={(e) => set({ taxMode: e.target.value as S['taxMode'] })}>
              <option value="exclusive">Before tax (GST added on the bill)</option>
              <option value="inclusive">Including tax (GST shown inside the total)</option>
              <option value="none">No tax on bill</option>
            </select>
          </label>
          {s.taxMode !== 'none' && s.gstType === 'custom' && (
            <div className="stack">
              {s.taxes.map((t, i) => (
                <div key={i} className="row">
                  <input value={t.name} onChange={(e) => set({ taxes: s.taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input style={{ width: 100 }} inputMode="decimal" value={t.rate} onChange={(e) => set({ taxes: s.taxes.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) || 0 } : x)) })} />
                  <span>%</span>
                  <button className="btn sm ghost danger" onClick={() => set({ taxes: s.taxes.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              {s.taxes.length < 5 && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => set({ taxes: [...s.taxes, { name: 'GST', rate: 5 }] })}>+ Add tax</button>}
            </div>
          )}
          {s.taxMode !== 'none' && s.gstType !== 'custom' && <div className="small">Taxes on the bill: <b>{s.taxes.map((t) => `${t.name} ${t.rate}%`).join(' + ')}</b></div>}
          <label>Service charge % (optional for the guest; GST is added on it)<input inputMode="decimal" value={s.serviceChargePct} onChange={(e) => set({ serviceChargePct: Number(e.target.value) || 0 })} /></label>
          <label className="check"><input type="checkbox" checked={s.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} />Round the grand total to the nearest rupee</label>
        </div>

        <div className="card pad stack">
          <h2>How you work</h2>
          <label>Type of business
            <select value={s.businessMode ?? 'restaurant'} onChange={(e) => set({ businessMode: e.target.value as S['businessMode'] })}>
              <option value="restaurant">Restaurant: tables, kitchen KOTs, QR ordering</option>
              <option value="counter">Small shop / food stall: quick billing only</option>
            </select>
          </label>
          <div className="small muted">Quick billing: tap the items, press Bill, and the receipt prints on the phone's printer. No tables or kitchen screens.</div>
          <label className="check"><input type="checkbox" checked={s.autoCleaning} onChange={(e) => set({ autoCleaning: e.target.checked })} />After payment, send the table to the cleaning crew</label>
          <label className="check"><input type="checkbox" checked={s.qrOrdering} onChange={(e) => set({ qrOrdering: e.target.checked })} />Guests can order from the table QR code (staff approve each order)</label>
          <label className="check"><input type="checkbox" checked={s.serversSeeAllTables} onChange={(e) => set({ serversSeeAllTables: e.target.checked })} />Servers can work on any table (untick: only their own)</label>
          <div className="grid2">
            <label>Time zone<input value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} /></label>
            <label>Phone country code (for WhatsApp)<input value={s.countryCode} onChange={(e) => set({ countryCode: e.target.value })} /></label>
          </div>
        </div>

        <div className="card pad stack">
          <h2>Network thermal printers (optional)</h2>
          <p className="small muted" style={{ margin: 0 }}>
            For LAN/Wi-Fi ESC/POS printers. Keep the YorMenu desktop app open and logged in on the counter PC (same Wi-Fi as the printers):
            it prints every KOT and bill automatically. The 🖨 chip at the top of the desktop app shows it is working.
            USB or Bluetooth printers work too: open the Kitchen screen on the device connected to the printer and tick “Auto-print KOTs”. Step-by-step guide and test print: Help → KOT / bill printer.
          </p>
          <label>Paper width<select value={s.paperWidth} onChange={(e) => set({ paperWidth: e.target.value as S['paperWidth'] })}><option value="80">80 mm (3 inch)</option><option value="58">58 mm (2 inch)</option></select></label>
          <PrinterField label="Kitchen (KOT) printer" value={s.kotPrinter} onChange={(v) => set({ kotPrinter: v })} />
          <PrinterField label="Bill printer" value={s.billPrinter} onChange={(v) => set({ billPrinter: v })} />
        </div>
      </div>
    </div>
  );
}

function PrinterField({ label, value, onChange }: { label: string; value: { host: string; port: number } | null; onChange: (v: { host: string; port: number } | null) => void }) {
  return (
    <div className="row">
      <label className="grow">{label} IP<input value={value?.host ?? ''} placeholder="e.g. 192.168.1.50" onChange={(e) => onChange(e.target.value ? { host: e.target.value, port: value?.port ?? 9100 } : null)} /></label>
      <label style={{ width: 100 }}>Port<input inputMode="numeric" value={value?.port ?? 9100} disabled={!value} onChange={(e) => value && onChange({ ...value, port: Number(e.target.value) || 9100 })} /></label>
    </div>
  );
}
