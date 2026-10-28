import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Navigate, Link } from 'react-router-dom';
import { useSession } from '../session';
import { homeFor } from '../Layout';

export default function Login() {
  const { me, login } = useSession();
  const [code, setCode] = useState(() => { try { return localStorage.getItem('yormenu.lastCode') ?? ''; } catch { return ''; } });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<{ supportPhone: string; supportHours: string } | null>(null);
  useEffect(() => { api.get('/public/support').then(setSupport).catch(() => {}); }, []);
  if (me) return <Navigate to={homeFor(me.user.role, me.restaurant.settings.businessMode)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(code.trim(), username.trim(), password); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="row"><img src="/icon.svg" width={36} height={36} alt="" /><div><h1>YorMenu</h1><div className="muted small">Staff login</div></div></div>
        <label>Restaurant code<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DEMO" autoCapitalize="characters" required /></label>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn primary lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small faint">Forgot your password? Ask your owner or manager.</div>
        {support?.supportPhone && <div className="small">Need help? Call YorMenu support <a href={`tel:${support.supportPhone}`}><b>{support.supportPhone}</b></a>{support.supportHours ? ` (${support.supportHours})` : ''}</div>}
        <Link className="btn block" to="/register">New shop or restaurant? Register free</Link>
        <div className="small faint"><Link to="/platform">Platform admin</Link></div>
      </form>
    </div>
  );
}
