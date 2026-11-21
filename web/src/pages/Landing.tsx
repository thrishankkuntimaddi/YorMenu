import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../icons';
import { Scene, type SceneKind } from '../scenes';

type Support = { supportName: string; supportPhone: string; supportWhatsapp: string; supportEmail: string; supportHours: string };

const RELEASES = 'https://github.com/thrishankkuntimaddi/YorMenu/releases/latest';
const DOWNLOADS = [
  { label: 'Android phone', note: 'Waiters, kitchen, counter', file: 'YorMenu-Android.apk', icon: 'phone' },
  { label: 'Windows PC', note: 'Counter with KOT & bill printer', file: 'YorMenu-Windows-Setup.exe', icon: 'printer' },
  { label: 'Mac (Apple Silicon)', note: 'Counter or owner’s desk', file: 'YorMenu-Mac-AppleSilicon.dmg', icon: 'store' },
];

/** The service, set like a menu card: what it does, and where in the restaurant it lives. */
const MENU: { course: string; items: [string, string, string][] }[] = [
  {
    course: 'On the floor',
    items: [
      ['Live tables', 'Floor', 'Every table’s state at a glance: seated, cooking, ready, billed, cleaning.'],
      ['Orders on the phone', 'Waiters', 'Take the order at the table. It reaches the kitchen before you walk back.'],
      ['QR menu', 'Guests', 'Guests scan the table QR to see the menu, order, call a waiter or ask for the bill.'],
    ],
  },
  {
    course: 'In the kitchen',
    items: [
      ['KOT screen & printer', 'Kitchen', 'Tickets land on the kitchen screen and thermal printer the moment they’re sent.'],
      ['Ready alerts', 'Chef', 'Mark a dish ready and the waiter’s phone beeps to pick it up.'],
    ],
  },
  {
    course: 'At the counter',
    items: [
      ['Billing with GST', 'Counter', 'Discounts, split payments, UPI, cash or card. Send the bill on WhatsApp.'],
      ['Pocket-printer billing', 'Stalls', 'Small shops bill straight from a phone with a Bluetooth receipt printer.'],
    ],
  },
  {
    course: 'For the owner',
    items: [
      ['Sales reports', 'Owner', 'Daily, weekly and monthly sales by item, staff and payment, in Excel and PDF.'],
      ['Staff & permissions', 'Owner', 'Decide what each role can see and do, down to voiding a bill.'],
      ['In your language', 'Everyone', 'English, తెలుగు and हिन्दी, chosen per person.'],
    ],
  },
];

const SERVICE: [SceneKind, string, string][] = [
  ['preparing', 'Order sent', 'The waiter taps the dishes. A KOT prints in the kitchen.'],
  ['cooking', 'On the stove', 'The kitchen screen shows what to cook, oldest first.'],
  ['serving', 'Out to the table', 'Marked ready, the waiter is told to serve.'],
  ['bill-ready', 'Bill printed', 'GST added, paid by UPI, sent on WhatsApp.'],
];

/** A sample KOT and bill, typeset like the thermal slips YorMenu prints. */
function Slips() {
  return (
    <div className="slips" role="img" aria-label="A sample kitchen ticket and a sample bill printed by YorMenu">
      <div className="slip kot-slip" aria-hidden="true">
        <div className="slip-row"><b>KOT #018</b><b>TABLE 4</b></div>
        <div className="slip-row faint-ink"><span>Ravi · waiter</span><span>8:42 PM</span></div>
        <hr />
        <div className="slip-item"><b>2</b><span>Paneer Tikka</span></div>
        <div className="slip-item"><b>1</b><span>Dal Makhani<em>less spicy</em></span></div>
        <div className="slip-item"><b>4</b><span>Butter Naan</span></div>
      </div>
      <div className="slip bill-slip" aria-hidden="true">
        <div className="slip-title">ANNAPURNA KITCHEN</div>
        <div className="slip-center faint-ink">Table 4 · Bill #1042</div>
        <hr />
        <div className="slip-row"><span>Paneer Tikka × 2</span><span>480.00</span></div>
        <div className="slip-row"><span>Dal Makhani × 1</span><span>260.00</span></div>
        <div className="slip-row"><span>Butter Naan × 4</span><span>200.00</span></div>
        <hr />
        <div className="slip-row"><span>Subtotal</span><span>940.00</span></div>
        <div className="slip-row faint-ink"><span>CGST 2.5%</span><span>23.50</span></div>
        <div className="slip-row faint-ink"><span>SGST 2.5%</span><span>23.50</span></div>
        <hr className="double" />
        <div className="slip-row slip-total"><span>TOTAL</span><span>₹ 987.00</span></div>
        <div className="slip-center faint-ink">Paid by UPI · Thank you!</div>
      </div>
    </div>
  );
}

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
        <div className="site-wrap site-bar-in">
          <Link to="/" className="site-mark"><img src="/icon.svg" width={30} height={30} alt="" /><span>YorMenu</span></Link>
          <nav className="site-links" aria-label="Sections">
            <a href="#menu">What it does</a>
            <a href="#apps">Apps</a>
            <a href="#contact">Contact</a>
          </nav>
          <Link className="btn site-login" to="/login">Staff login</Link>
        </div>
      </header>

      <section className="site-wrap site-hero">
        <div className="site-hero-copy">
          <p className="site-kicker">For restaurants, cafés, dhabas and food stalls</p>
          <h1>Take the order.<br />Fire the kitchen.<br /><em>Print the bill.</em></h1>
          <p className="site-lede">One system for the waiters, the kitchen and the counter, always in sync. Run it on the website, a counter PC or any Android phone. A small stall needs nothing more than a phone and a pocket printer.</p>
          <div className="site-cta">
            <Link className="btn primary lg" to="/register">Register your shop, free trial</Link>
            <a className="btn lg site-ghost" href="#contact">Talk to us</a>
          </div>
        </div>
        <Slips />
      </section>

      <section className="site-service" aria-labelledby="service-h">
        <div className="site-wrap">
          <h2 id="service-h" className="site-h2">One table, start to finish</h2>
          <ol className="service-steps">
            {SERVICE.map(([kind, title, text], i) => (
              <li key={kind}>
                <Scene kind={kind} />
                <div><span className="service-n">{i + 1}</span><b>{title}</b><p>{text}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="site-wrap site-section" id="menu" aria-labelledby="menu-h">
        <div className="menu-card">
          <h2 id="menu-h" className="menu-card-title"><span>On the menu</span></h2>
          <div className="menu-courses">
            {MENU.map((c) => (
              <div key={c.course} className="menu-course">
                <h3>{c.course}</h3>
                {c.items.map(([name, where, text]) => (
                  <div key={name} className="menu-dish">
                    <div className="menu-dish-line"><b>{name}</b><span className="leader" /><span className="menu-where">{where}</span></div>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-wrap site-section site-split" id="apps">
        <div>
          <h2 className="site-h2">Opening day</h2>
          <ol className="open-steps">
            <li><span><b>Call us.</b> We set up your restaurant, menu and tables, and give the owner a login.</span></li>
            <li><span><b>Install the app</b> on the counter PC and staff phones, or just use this website.</span></li>
            <li><span><b>Connect the printers</b> for KOT and bills. Start taking orders.</span></li>
          </ol>
        </div>
        <div className="apps-card">
          <h2 className="site-h2">Get the apps</h2>
          <div className="apps-list">
            {DOWNLOADS.map((d) => (
              <a key={d.file} className="app-dl" href={`${RELEASES}/download/${d.file}`}>
                <Icon name={d.icon} size={22} />
                <span><b>{d.label}</b><small>{d.note}</small></span>
                <Icon name="download" size={18} />
              </a>
            ))}
          </div>
          <a className="small apps-all" href={RELEASES}>All downloads and release notes →</a>
        </div>
      </section>

      <section className="site-contact" id="contact">
        <div className="site-wrap site-contact-in">
          <div>
            <h2>Call us. We’ll set up your menu.</h2>
            <p>{support?.supportName ? `${support.supportName}. ` : ''}Tell us about your place and we’ll have your tables, dishes and printers ready.</p>
            {support?.supportHours && <p className="small">{support.supportHours}</p>}
          </div>
          <div className="site-contact-actions">
            {phone ? (<>
              <a className="btn primary lg" href={`tel:${phone}`}><Icon name="phone" size={18} />{phone}</a>
              {wa && <a className="btn lg site-wa" target="_blank" rel="noreferrer" href={`https://wa.me/${wa.length === 10 ? '91' + wa : wa}?text=${encodeURIComponent('Hi, I want to know about YorMenu for my restaurant.')}`}><Icon name="whatsapp" size={18} />WhatsApp</a>}
              {support?.supportEmail && <a className="btn lg site-ghost" href={`mailto:${support.supportEmail}`}><Icon name="mail" size={18} />{support.supportEmail}</a>}
            </>) : <span className="small">Loading contact…</span>}
          </div>
        </div>
      </section>

      <footer className="site-wrap site-foot">
        <span>© {new Date().getFullYear()} YorMenu</span>
        <span>Already a customer? <Link to="/login">Log in</Link> with your restaurant code.</span>
      </footer>
    </div>
  );
}
