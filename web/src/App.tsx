import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';
import Layout, { homeFor } from './Layout';
import Login from './pages/Login';
import { Loading } from './ui';
import { lazy, Suspense, type ReactElement } from 'react';

// Each screen downloads only when it is first opened, so the app starts fast on phones.
const Floor = lazy(() => import('./pages/Floor'));
const OrderScreen = lazy(() => import('./pages/OrderScreen'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Bills = lazy(() => import('./pages/Bills'));
const Cleaning = lazy(() => import('./pages/Cleaning'));
const Requests = lazy(() => import('./pages/Requests'));
const Reports = lazy(() => import('./pages/Reports'));
const MenuAdmin = lazy(() => import('./pages/MenuAdmin'));
const TablesAdmin = lazy(() => import('./pages/TablesAdmin'));
const Staff = lazy(() => import('./pages/Staff'));
const Settings = lazy(() => import('./pages/Settings'));
const Audit = lazy(() => import('./pages/Audit'));
const Platform = lazy(() => import('./pages/Platform'));
const Guest = lazy(() => import('./pages/Guest'));
const Permissions = lazy(() => import('./pages/Permissions'));
const Compliance = lazy(() => import('./pages/Compliance'));
const Help = lazy(() => import('./pages/Help'));
const Landing = lazy(() => import('./pages/Landing'));
const PrinterSetup = lazy(() => import('./pages/PrinterSetup'));
const QuickBill = lazy(() => import('./pages/QuickBill'));
const Register = lazy(() => import('./pages/Register'));
const Subscription = lazy(() => import('./pages/Subscription'));

function Guard({ perm, children }: { perm: string; children: ReactElement }) {
  const { can, me } = useSession();
  if (!can(perm)) {
    // A role with no main screen (everything switched off) lands on Help instead of looping.
    const home = homeFor(me!.user.role, me!.restaurant.settings.businessMode);
    return <Navigate to={home === window.location.pathname ? '/help' : home} replace />;
  }
  return children;
}

function Private() {
  const { me, loading } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  const { me } = useSession();
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/" element={me ? <Navigate to={homeFor(me.user.role, me.restaurant.settings.businessMode)} replace /> : <Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/platform" element={<Platform />} />
      <Route path="/t/:token" element={<Guest />} />
      <Route element={<Private />}>
        <Route path="/floor" element={<Guard perm="floor.view"><Floor /></Guard>} />
        <Route path="/order/:id" element={<Guard perm="floor.view"><OrderScreen /></Guard>} />
        <Route path="/kitchen" element={<Guard perm="kitchen.view"><Kitchen /></Guard>} />
        <Route path="/bills" element={<Guard perm="bill.view"><Bills /></Guard>} />
        <Route path="/cleaning" element={<Guard perm="cleaning.view"><Cleaning /></Guard>} />
        <Route path="/requests" element={<Guard perm="guest.handle"><Requests /></Guard>} />
        <Route path="/reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
        <Route path="/admin/menu" element={<Guard perm="menu.availability"><MenuAdmin /></Guard>} />
        <Route path="/admin/tables" element={<Guard perm="tables.edit"><TablesAdmin /></Guard>} />
        <Route path="/admin/staff" element={<Guard perm="staff.view"><Staff /></Guard>} />
        <Route path="/admin/settings" element={<Guard perm="settings.edit"><Settings /></Guard>} />
        <Route path="/admin/audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
        <Route path="/admin/permissions" element={<Guard perm="permissions.edit"><Permissions /></Guard>} />
        <Route path="/admin/compliance" element={<Guard perm="compliance.manage"><Compliance /></Guard>} />
        <Route path="/help" element={<Help />} />
        <Route path="/printer" element={<PrinterSetup />} />
        <Route path="/admin/subscription" element={<Guard perm="settings.edit"><Subscription /></Guard>} />
        <Route path="/quick" element={<Guard perm="bill.generate"><QuickBill /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to={me ? homeFor(me.user.role, me.restaurant.settings.businessMode) : '/'} replace />} />
    </Routes>
    </Suspense>
  );
}
