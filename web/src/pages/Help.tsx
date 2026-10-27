import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { dateTimeOf } from '../format';
import { Icon } from '../icons';
import { useT } from '../i18n';

type Section = 'support' | 'kot' | 'whatsapp' | 'apps' | 'roles';

export default function Help() {
  const { me, can } = useSession();
  const t = useT();
  const [sec, setSec] = useState<Section>('support');
  const sections: [Section, string][] = [
    ['support', 'Contact support'], ['kot', 'KOT / bill printer'], ['whatsapp', 'WhatsApp bills'], ['apps', 'Phones, APK & desktop'], ['roles', 'Who can do what'],
  ];
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head"><h1>{t('Help')}</h1></div>
      <div className="side-layout">
        <div className="side-nav">{sections.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{l}</button>)}</div>
        <div className="stack lg">
          {sec === 'support' && <Support canRaise={can('support.raise')} />}
          {sec === 'kot' && <KotGuide canTest={can('settings.edit')} />}
          {sec === 'whatsapp' && <WhatsAppGuide code={me!.restaurant.settings.countryCode} />}
          {sec === 'apps' && <AppsGuide />}
          {sec === 'roles' && <RolesGuide />}
        </div>
      </div>
    </div>
  );
}

function Support({ canRaise }: { canRaise: boolean }) {
  const { me } = useSession();
  const s = me!.support;
  const wa = s.supportWhatsapp.replace(/\D/g, '');
  return (
    <>
      <div className="card pad stack">
        <h2>{s.companyName} support</h2>
        {s.supportName && <div><b>{s.supportName}</b></div>}
        <div className="muted">{s.supportHours}</div>
        {!s.supportPhone && !s.supportEmail && <div className="muted">Support contact isn't set yet. Ask your platform admin.</div>}
        <div className="row wrap">
          {s.supportPhone && <a className="btn primary lg" href={`tel:${s.supportPhone}`}><Icon name="phone" />Call {s.supportPhone}</a>}
          {wa && <a className="btn ok lg" target="_blank" rel="noreferrer" href={`https://wa.me/${wa.length === 10 ? '91' + wa : wa}?text=${encodeURIComponent(`Hi, this is ${me!.user.name} from ${me!.restaurant.name} (${me!.restaurant.code}).`)}`}><Icon name="whatsapp" />WhatsApp</a>}
          {s.supportEmail && <a className="btn lg" href={`mailto:${s.supportEmail}?subject=${encodeURIComponent(`${me!.restaurant.code}: `)}`}><Icon name="mail" />{s.supportEmail}</a>}
        </div>
        <div className="small faint">Your restaurant code is <b>{me!.restaurant.code}</b>. Tell support this code when you call.</div>
      </div>
      {canRaise ? <Tickets /> : <div className="muted">Ask your owner or manager to raise an issue with YorMenu for you.</div>}
    </>
  );
}

const CATEGORIES: [string, string][] = [
  ['printer', 'Printer / KOT'], ['whatsapp', 'WhatsApp bill'], ['billing', 'Bills & payments'], ['technical', 'App not working'],
  ['account', 'Login / staff accounts'], ['compliance', 'Licences'], ['feature', 'New feature request'], ['other', 'Other'],
];

function Tickets() {
  const { data, error, reload } = useLoad(() => api.get<any[]>('/support/tickets'));
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card pad stack">
      <div className="row between"><h2>My issues</h2><button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />Report an issue</button></div>
      {data.length ? (
        <table className="list">
          <tbody>{data.map((k) => (
            <tr key={k.id} className="click" onClick={() => setOpen(k.id)}>
              <td><b>#{k.id} {k.subject}</b><div className="small faint">{CATEGORIES.find((c) => c[0] === k.category)?.[1]} · {k.messages} messages{k.last_by === 'platform' && ' · support replied'}</div></td>
              <td><span className={`state-pill ${k.priority}`}>{k.priority}</span></td>
              <td><span className={`state-pill ${k.status}`}>{k.status.replace('_', ' ')}</span></td>
              <td className="small r">{dateTimeOf(k.updated_at)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="faint">No issues raised. Problems with the printer, WhatsApp or the app? Report them here and support will reply.</div>}
      {creating && <NewTicket onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); reload(); setOpen(id); }} />}
      {open && <TicketThread id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function NewTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState({ category: 'printer', priority: 'normal', subject: '', message: '' });
  const { run, busy } = useAction();
  return (
    <Modal title="Report an issue" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || f.subject.length < 3 || f.message.length < 3}
        onClick={() => run(async () => { const r = await api.post('/support/tickets', f); onDone(r.id); }, 'Sent to YorMenu support')}>Send</button>
    </>}>
      <div className="grid2">
        <label>What is it about?<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>How urgent?<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="low">Low – when you can</option><option value="normal">Normal</option><option value="high">High – affecting service</option><option value="urgent">Urgent – can't take orders</option>
        </select></label>
      </div>
      <label>Short title<input value={f.subject} maxLength={120} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Kitchen printer not printing KOTs" /></label>
      <label>What happened?<textarea rows={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Which screen, what you tapped, what you saw…" /></label>
    </Modal>
  );
}

function TicketThread({ id, onClose }: { id: number; onClose: () => void }) {
  const { me } = useSession();
  const { data, error, reload } = useLoad(() => api.get<any>(`/support/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const { run, busy } = useAction();
  return (
    <Modal wide title={data ? `#${data.id} ${data.subject}` : 'Issue'} onClose={onClose} footer={data && data.status !== 'closed' ? <>
      <button className="btn" onClick={() => run(async () => { await api.post(`/support/tickets/${id}/close`); onClose(); }, 'Closed')}>Mark solved & close</button>
      <button className="btn primary" disabled={busy || !body.trim()} onClick={() => run(async () => { await api.post(`/support/tickets/${id}/messages`, { body }); setBody(''); reload(); })}>Send</button>
    </> : undefined}>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="row"><span className={`state-pill ${data.status}`}>{data.status.replace('_', ' ')}</span><span className={`state-pill ${data.priority}`}>{data.priority}</span></div>
          <div className="chat">{data.messages.map((m: any) => (
            <div key={m.id} className={`msg ${m.author_kind === 'staff' ? 'mine' : ''}`}><span className="who">{m.author_name} · {dateTimeOf(m.created_at)}</span>{m.body}</div>
          ))}</div>
          {data.status !== 'closed' && <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Reply as ${me?.user.name}`} />}
        </>
      )}
    </Modal>
  );
}

function KotGuide({ canTest }: { canTest: boolean }) {
  const { run, busy } = useAction();
  return (
    <>
      <div className="card pad stack">
        <h2>Option A · Wi-Fi / LAN thermal printer (best)</h2>
        <div className="muted">Every KOT prints in the kitchen by itself, even if no tablet is open. Works with most 80 mm / 58 mm ESC/POS printers (Epson TM-T82, TVS RP 3160, Everycom, Rugtek…) that have a LAN or Wi-Fi port.</div>
        <ol className="steps">
          <li>Connect the printer to your restaurant router with a LAN cable (or set up its Wi-Fi using the maker's tool).</li>
          <li>Switch the printer off, hold the FEED button, switch it on. It prints a self-test page with its <b>IP address</b> (e.g. 192.168.1.87).</li>
          <li>In your router, reserve that IP for the printer (“DHCP reservation”) so it never changes. Your Wi-Fi installer can do this.</li>
          <li>Open <b>Settings → Network thermal printers</b>, type the IP in “Kitchen (KOT) printer”, port <b>9100</b>, choose paper width, Save.</li>
          <li>Tap <b>Test kitchen printer</b> below. A test slip should come out.</li>
          <li>Do the same for the bill printer at the counter if it's also a network printer.</li>
        </ol>
        {canTest && <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/printers/test', { target: 'kot' }), 'Test sent. The counter PC prints it in a few seconds.')}><Icon name="printer" />Test kitchen printer</button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.post('/printers/test', { target: 'bill' }), 'Test sent. The counter PC prints it in a few seconds.')}><Icon name="printer" />Test bill printer</button>
        </div>}
        <div className="callout">The counter PC running the YorMenu desktop app (logged in, showing 🖨 Print station) sends the KOTs to the printer, so the PC and the printer must be on the same router. If the PC is off, KOTs wait and print as soon as it is back.</div>
      </div>
      <div className="card pad stack">
        <h2>Option B · USB printer on the counter PC or a kitchen tablet</h2>
        <ol className="steps">
          <li>Install the printer driver from the maker (Windows) and print a test page from Windows so you know it works.</li>
          <li>Set it as the <b>default printer</b>, with paper size 80 mm (or 58 mm) and no margins.</li>
          <li>On that computer open the <b>Kitchen</b> screen and tick <b>Auto-print KOTs</b>. Keep that screen open.</li>
          <li>In the YorMenu desktop app printing goes straight to the default printer without a pop-up. In Chrome, start it with <code>--kiosk-printing</code> for the same.</li>
        </ol>
      </div>
      <div className="card pad stack">
        <h2>Option C · Bluetooth printer with an Android tablet</h2>
        <ol className="steps">
          <li>Pair the printer in Android Bluetooth settings.</li>
          <li>Install a print service app such as “RawBT” and set the printer in it.</li>
          <li>Open the YorMenu app → Kitchen → tick Auto-print KOTs. Choose RawBT when Android asks which printer to use.</li>
        </ol>
      </div>
    </>
  );
}

function WhatsAppGuide({ code }: { code: string }) {
  return (
    <>
      <div className="card pad stack">
        <h2>Send the bill on WhatsApp (free)</h2>
        <ol className="steps">
          <li>Install WhatsApp (or WhatsApp Business, recommended) on the billing phone / counter PC and log in with the restaurant's number.</li>
          <li>When taking a parcel, delivery or dine-in order, type the customer's 10-digit mobile number. (Country code +{code} is added automatically; change it in Settings.)</li>
          <li>After closing the table, open the bill and tap <b>WhatsApp</b>. If the number is missing, type it in.</li>
          <li>WhatsApp opens with the full bill already written. Tap <b>Send</b>.</li>
        </ol>
        <div className="callout">The message goes from your restaurant's own WhatsApp, so customers see your name. Nothing is sent without the cashier tapping Send.</div>
      </div>
      <div className="card pad stack">
        <h2>Daily report to the owner on WhatsApp</h2>
        <ol className="steps">
          <li>Reports → Automatic reports → enter the owner's WhatsApp number → Save.</li>
          <li>Reports → pick Today / Week / Month → <b>WhatsApp summary</b>. WhatsApp opens with the sales summary addressed to the owner.</li>
          <li>For fully automatic messages without tapping Send you need a paid WhatsApp Business API account (e.g. through Meta, Gupshup or Interakt). Raise a support issue when you want it.</li>
        </ol>
      </div>
    </>
  );
}

function AppsGuide() {
  const origin = window.location.origin;
  return (
    <>
      <div className="card pad stack">
        <h2>1 · Counter PC (desktop app)</h2>
        <ol className="steps">
          <li>Install <b>YorMenu Desktop</b> on the billing computer (Windows or Mac). It keeps all your data on this computer, works without internet, and sends the automatic reports.</li>
          <li>Keep it running during business hours. Turn off sleep mode in the power settings.</li>
          <li>Its home screen shows the <b>restaurant address</b> (like <code>http://192.168.1.10:4000</code>) and a QR code for phones.</li>
          <li>Use <b>Backup</b> in the desktop app every week and copy the backup to Google Drive or a pen drive.</li>
        </ol>
      </div>
      <div className="card pad stack">
        <h2>2 · Waiter / kitchen phones</h2>
        <ol className="steps">
          <li>Connect the phone to the <b>restaurant Wi-Fi</b> (same router as the counter PC).</li>
          <li><b>Android APK:</b> install <code>YorMenu.apk</code>, open it, scan the QR code on the counter PC (or type the address).</li>
          <li><b>Any phone without the APK:</b> open Chrome / Safari, go to <code>{origin}</code>, then menu → <b>Add to Home screen</b>. It then opens like an app.</li>
          <li>Log in with restaurant code, username and password from your manager.</li>
        </ol>
      </div>
      <div className="card pad stack">
        <h2>Privacy & safety</h2>
        <ul className="steps">
          <li>Everyone has their own login. Never share passwords; a manager can reset them in Staff.</li>
          <li>5 wrong passwords lock the login for 15 minutes.</li>
          <li>Disabling a staff member logs them out on every phone at once.</li>
          <li>The owner can set auto-logout for idle phones in Settings.</li>
          <li>Customer phone numbers can be hidden from any role in Permissions.</li>
          <li>Every cancel, void, discount, price change, permission change and report download is in Activity.</li>
          <li>YorMenu platform admins can never see your orders, bills or customers.</li>
        </ul>
      </div>
    </>
  );
}

function RolesGuide() {
  const rows: [string, string][] = [
    ['Platform admin (YorMenu)', 'Creates the restaurant, gives the owner login, verifies licences, answers support issues. Cannot see orders, bills or customers.'],
    ['Owner', 'Everything. Sets the permission matrix for trustee, manager and staff. Gets automatic reports.'],
    ['Trustee / co-founder', 'Like the owner, but cannot change the owner.'],
    ['Manager', 'Runs the floor: staff accounts, menu, tables, reports. Sets permissions for billing, servers, kitchen and cleaning (only things the manager can do too).'],
    ['Billing counter', 'Bills, payments, WhatsApp bills, guest requests, sees the kitchen.'],
    ['Server', 'Tables, orders, KOTs, serving, guest QR orders, cleaning requests.'],
    ['Kitchen', 'KOT screen, cooking/ready, mark dishes sold out.'],
    ['Cleaning crew', 'Cleaning list.'],
  ];
  return (
    <div className="card pad stack">
      <h2>Chain of control</h2>
      <table className="list"><tbody>{rows.map(([r, d]) => <tr key={r}><td style={{ width: 200 }}><b>{r}</b></td><td>{d}</td></tr>)}</tbody></table>
      <div className="small muted">The owner can change these in <b>Permissions</b>. Safety limits can't be switched off (for example, the cleaning crew can never void a bill).</div>
    </div>
  );
}
