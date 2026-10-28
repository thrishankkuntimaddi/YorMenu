import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';

type Support = { supportName: string; supportPhone: string; supportWhatsapp: string; supportEmail: string; supportHours: string };

const RELEASES = 'https://github.com/thrishankkuntimaddi/YorMenu/releases/latest';
const DOWNLOADS = [
  { label: 'Android phone', file: 'YorMenu-Android.apk', icon: 'phone' },
  { label: 'Windows PC', file: 'YorMenu-Windows-Setup.exe', icon: 'grid' },
  { label: 'Mac (Apple Silicon)', file: 'YorMenu-Mac-AppleSilicon.dmg', icon: 'grid' },
];

const SERVICES: [string, string][] = [
  ['Table & order management', 'See every table live. Waiters take orders on their phone.'],
  ['Kitchen KOT', 'Orders reach the kitchen screen and thermal printer instantly.'],
  ['Billing & GST', 'Bills with GST, discounts, UPI / cash / card, sent on WhatsApp.'],
  ['QR menu', 'Guests scan the table QR to see the menu and order.'],
  ['Staff & permissions', 'The owner decides what each staff member can do.'],
  ['Owner reports', 'Daily, weekly and monthly sales by email, Excel and PDF.'],
];

/** Public front page: what YorMenu is, how to get it, who to call. */
export default function Landing() {
  const [support, setSupport] = useState<Support | null>(null);
  useEffect(() => {
    document.title = 'YorMenu · Restaurant POS';
    api.get<Support>('/public/support').then(setSupport).catch(() => {});
    import('../firebase').then((m) => m.startSiteAnalytics()).catch(() => {});
  }, []);
  const phone = support?.supportPhone;
  const wa = (support?.supportWhatsapp || phone || '').replace(/\D/g, '');
  return (
    <div className="site">
      <header className="site-bar">
        <div className="site-wrap row between">
          <span className="row"><img src="/icon.svg" width={32} height={32} alt="" /><b style={{ fontSize: 18 }}>YorMenu</b></span>
          <Link className="btn primary" to="/login">Login</Link>
        </div>
      </header>

      <section className="site-wrap site-hero2">
        <h1>Restaurant billing, KOT and reports, on your phone.</h1>
        <p className="muted">One system for the counter, waiters and kitchen. Small shops and food stalls bill straight from a phone with a pocket Bluetooth printer. Works on website, desktop and Android, always in sync.</p>
        <div className="row wrap">
          <Link className="btn primary lg" to="/register">Register your shop: free trial</Link>
          <Link className="btn lg" to="/login">Staff login</Link>
          <a className="btn lg" href="#contact">Talk to us</a>
        </div>
      </section>

      <section className="site-wrap site-section">
        <h2>What we offer</h2>
        <div className="site-list">
          {SERVICES.map(([t, d]) => <div key={t}><b>{t}</b><div className="muted small">{d}</div></div>)}
        </div>
      </section>

      <section className="site-wrap site-section">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Call us. We set up your restaurant, menu and tables, and give the owner a login.</li>
          <li>Install the app on the counter PC and staff phones (or just use this website).</li>
          <li>Connect your KOT and bill printer to the counter PC. Start taking orders.</li>
        </ol>
      </section>

      <section className="site-wrap site-section">
        <h2>Get the apps</h2>
        <div className="row wrap">
          {DOWNLOADS.map((d) => <a key={d.file} className="btn" href={`${RELEASES}/download/${d.file}`}><Icon name="download" size={16} />{d.label}</a>)}
          <a className="btn ghost" href={RELEASES}>All downloads</a>
        </div>
      </section>

      <section className="site-wrap site-section" id="contact">
        <div className="card pad stack">
          <h2>Contact & support</h2>
          {support?.supportName && <div><b>{support.supportName}</b></div>}
          {phone ? (
            <div className="row wrap">
              <a className="btn primary" href={`tel:${phone}`}><Icon name="phone" size={16} />{phone}</a>
              {wa && <a className="btn ok" target="_blank" rel="noreferrer" href={`https://wa.me/${wa.length === 10 ? '91' + wa : wa}?text=${encodeURIComponent('Hi, I want to know about YorMenu for my restaurant.')}`}><Icon name="whatsapp" size={16} />WhatsApp</a>}
              {support?.supportEmail && <a className="btn" href={`mailto:${support.supportEmail}`}><Icon name="mail" size={16} />{support.supportEmail}</a>}
            </div>
          ) : <div className="muted">Loading contact…</div>}
          {support?.supportHours && <div className="small muted">{support.supportHours}</div>}
          <div className="small muted">Already a customer? <Link to="/login">Log in</Link> with your restaurant code. Owners can reach support from Help inside the app.</div>
        </div>
      </section>

      <footer className="site-wrap small faint" style={{ textAlign: 'center', padding: '24px 16px 40px' }}>© {new Date().getFullYear()} YorMenu</footer>
    </div>
  );
}
