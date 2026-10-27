import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';
import Layout, { homeFor } from './Layout';
import Login from './pages/Login';
import Floor from './pages/Floor';
import OrderScreen from './pages/OrderScreen';
import Kitchen from './pages/Kitchen';
import Bills from './pages/Bills';
import Cleaning from './pages/Cleaning';
import Requests from './pages/Requests';
import Reports from './pages/Reports';
import MenuAdmin from './pages/MenuAdmin';
import TablesAdmin from './pages/TablesAdmin';
import Staff from './pages/Staff';
import Settings from './pages/Settings';
import Audit from './pages/Audit';
import Platform from './pages/Platform';
import Guest from './pages/Guest';
import { Loading } from './ui';
import type { ReactElement } from 'react';

function Guard({ perm, children }: { perm: string; children: ReactElement }) {
  const { can, me } = useSession();
  if (!can(perm)) return <Navigate to={homeFor(me!.user.role)} replace />;
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
    <Routes>
      <Route path="/login" element={<Login />} />
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
      </Route>
      <Route path="*" element={<Navigate to={me ? homeFor(me.user.role) : '/login'} replace />} />
    </Routes>
  );
}
