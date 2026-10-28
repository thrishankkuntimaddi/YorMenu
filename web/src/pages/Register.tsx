import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAction } from '../ui';
import { Icon } from '../icons';

type Status = { status: 'none' | 'pending' | 'approved' | 'rejected'; code?: string; username?: string; businessName?: string; reason?: string };
type Photo = { kind: 'fssai' | 'id' | 'gst' | 'shop_photo'; name: string; type: 'image/jpeg'; data: string; preview: string };

const PHOTO_KINDS: [Photo['kind'], string, string][] = [
  ['fssai', 'FSSAI certificate / registration', 'Needed to sell food. Basic registration is fine for small vendors.'],
  ['id', 'ID proof of the owner', 'Aadhaar, PAN, voter ID or driving licence.'],
  ['gst', 'GST certificate (if registered)', 'Only if you have a GSTIN.'],
  ['shop_photo', 'Photo of your shop / stall (optional)', 'Helps us verify faster.'],
];

/** Shrink a phone photo to a small JPEG (well under 1 MB) so it uploads quickly. */
async function compress(file: File): Promise<{ data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Could not read the photo')); i.src = url; });
    for (const [max, quality] of [[1400, 0.72], [1100, 0.6], [900, 0.5]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      const data = dataUrl.split(',')[1];
      if (data.length < 850_000) return { data, preview: dataUrl };
    }
    throw new Error('This photo is too large. Take it again a little further away.');
  } finally { URL.revokeObjectURL(url); }
}

/** Self sign-up for shops, food stalls and restaurants. */
export default function Register() {
  const [status, setStatus] = useState<Status | null>(null);
  const [plans, setPlans] = useState<{ trialDays: number; plans: { id: string; name: string; price: number; days: number; for: string }[] } | null>(null);
  const [f, setF] = useState({
    businessType: 'counter' as 'counter' | 'restaurant', businessName: '', ownerName: '', mobile: '', email: '',
    address: '', city: '', state: '', gstin: '', fssai: '', username: 'owner', password: '', password2: '',
  });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [err, setErr] = useState('');
  const { run, busy } = useAction();

  const check = () => api.get<Status>('/public/register/status').then(setStatus).catch(() => setStatus({ status: 'none' }));
  useEffect(() => { check(); api.get('/public/billing').then(setPlans).catch(() => {}); }, []);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const addPhoto = (kind: Photo['kind']) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { data, preview } = await compress(file);
      setPhotos((p) => [...p.filter((x) => x.kind !== kind), { kind, name: file.name, type: 'image/jpeg', data, preview }]);
    } catch (x: any) { setErr(x.message); }
  };

  const submit = () => run(async () => {
    setErr('');
    if (f.password !== f.password2) { setErr('The two passwords are not the same'); return; }
    const { password2: _p, ...body } = f;
    await api.post('/public/register', { ...body, files: photos.map(({ preview: _v, ...p }) => p) });
    try { localStorage.setItem('yormenu.signupUser', f.username); } catch { /* ignore */ }
    await check();
  });

  if (!status) return <div className="login-wrap"><div className="muted">Loading…</div></div>;

  if (status.status !== 'none') {
    return (
      <div className="login-wrap">
        <div className="card login">
          <div className="row"><img src="/icon.svg" width={36} height={36} alt="" /><div><h1>{status.businessName}</h1><div className="muted small">YorMenu registration</div></div></div>
          {status.status === 'pending' && (<>
            <div className="callout">✅ We got your details and documents. Our team checks them, usually within a day, and will call you on your mobile.</div>
            <button className="btn" onClick={check}>Check again</button>
          </>)}
          {status.status === 'approved' && (<>
            <div className="callout">🎉 You're approved! Log in with this shop code, your username <b>{status.username}</b> and your password.</div>
            <div className="code-big">{status.code}</div>
            <Link className="btn primary lg" to="/login" onClick={() => { try { localStorage.setItem('yormenu.lastCode', status.code ?? ''); } catch { /* ignore */ } }}>Log in</Link>
          </>)}
          {status.status === 'rejected' && (<>
            <div className="err">Your registration was not approved: {status.reason}</div>
            <div className="small muted">Call YorMenu support, or register again with the right documents.</div>
          </>)}
          <Link className="small" to="/login">← Back to login</Link>
        </div>
      </div>
    );
  }

  const ok = f.businessName && f.ownerName && /^\d{10}$/.test(f.mobile) && f.address && f.city && f.state && f.password.length >= 6
    && photos.some((p) => p.kind === 'fssai' || p.kind === 'id');
  return (
    <div className="login-wrap" style={{ alignItems: 'start' }}>
      <div className="card login stack" style={{ maxWidth: 560 }}>
        <div className="row"><img src="/icon.svg" width={36} height={36} alt="" /><div><h1>Register your shop</h1><div className="muted small">Billing on your phone, with a receipt printer</div></div></div>
        {plans && <div className="callout">Free for {plans.trialDays} days. Then from ₹{Math.min(...plans.plans.map((p) => p.price))} a month. No laptop needed: a phone or tablet and a small Bluetooth printer is enough.</div>}

        <div className="segmented" style={{ width: '100%' }}>
          <button style={{ flex: 1 }} className={f.businessType === 'counter' ? 'on' : ''} onClick={() => setF({ ...f, businessType: 'counter' })}>Shop / food stall</button>
          <button style={{ flex: 1 }} className={f.businessType === 'restaurant' ? 'on' : ''} onClick={() => setF({ ...f, businessType: 'restaurant' })}>Restaurant with tables</button>
        </div>
        <label>Shop / restaurant name<input value={f.businessName} onChange={set('businessName')} /></label>
        <div className="grid2">
          <label>Your name<input value={f.ownerName} onChange={set('ownerName')} autoComplete="name" /></label>
          <label>Mobile number<input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(-10) })} inputMode="numeric" autoComplete="tel-national" /></label>
        </div>
        <label>Address<input value={f.address} onChange={set('address')} autoComplete="street-address" /></label>
        <div className="grid2">
          <label>City / town<input value={f.city} onChange={set('city')} /></label>
          <label>State<input value={f.state} onChange={set('state')} /></label>
        </div>
        <div className="grid2">
          <label>FSSAI number (14 digits)<input value={f.fssai} onChange={(e) => setF({ ...f, fssai: e.target.value.replace(/\D/g, '').slice(0, 14) })} inputMode="numeric" /></label>
          <label>GSTIN (if you have one)<input value={f.gstin} onChange={set('gstin')} autoCapitalize="characters" /></label>
        </div>
        <label>Email (optional)<input value={f.email} onChange={set('email')} type="email" autoComplete="email" /></label>

        <h3 style={{ marginTop: 6 }}>Documents</h3>
        <div className="small muted">Take clear photos. At least the FSSAI certificate or an ID proof.</div>
        {PHOTO_KINDS.map(([kind, label, hint]) => {
          const p = photos.find((x) => x.kind === kind);
          return (
            <div key={kind} className="row between" style={{ gap: 12 }}>
              <div className="grow"><b className="small">{label}</b><div className="small faint">{hint}</div></div>
              {p && <img src={p.preview} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6 }} />}
              <label className="btn sm" style={{ display: 'inline-flex' }}>
                <Icon name="plus" size={14} />{p ? 'Change' : 'Add photo'}
                <input type="file" accept="image/*" capture="environment" onChange={addPhoto(kind)} style={{ display: 'none' }} />
              </label>
            </div>
          );
        })}

        <h3 style={{ marginTop: 6 }}>Your login</h3>
        <div className="grid2">
          <label>Username<input value={f.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" /></label>
          <span />
          <label>Password (min 6)<input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
          <label>Password again<input type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" /></label>
        </div>
        <div className="small muted">After approval you get a shop code. You log in with the code, this username and password.</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg" disabled={busy || !ok} onClick={submit}>{busy ? 'Sending…' : 'Submit for verification'}</button>
        <Link className="small" to="/login">← I already have a login</Link>
      </div>
    </div>
  );
}
