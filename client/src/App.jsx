import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner, EmptyState, Button } from './components/ui';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Resources = lazy(() => import('./pages/Resources'));
const LabDetail = lazy(() => import('./pages/LabDetail'));
const EquipmentDetail = lazy(() => import('./pages/EquipmentDetail'));
const BookingNew = lazy(() => import('./pages/BookingNew'));
const Finder = lazy(() => import('./pages/Finder'));
const MyBookings = lazy(() => import('./pages/MyBookings'));
const AllBookings = lazy(() => import('./pages/AllBookings'));
const BookingDetail = lazy(() => import('./pages/BookingDetail'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Occupancy = lazy(() => import('./pages/Occupancy'));
const Waitlist = lazy(() => import('./pages/Waitlist'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Conflicts = lazy(() => import('./pages/Conflicts'));
const Desk = lazy(() => import('./pages/Desk'));
const Scan = lazy(() => import('./pages/Scan'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Rules = lazy(() => import('./pages/Rules'));
const UsersPage = lazy(() => import('./pages/Users'));
const Catalog = lazy(() => import('./pages/Catalog'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Permissions = lazy(() => import('./pages/Permissions'));

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Spinner className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** Gate a page on a permission from the role/permission matrix. */
function RequirePerm({ perm, children }) {
  const { can } = useAuth();
  if (!can(perm)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="Your role doesn't have this permission. The administrator can grant it under Roles & permissions."
        action={
          <Link to="/">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        }
      />
    );
  }
  return children;
}

const guard = (perm, el) => <RequirePerm perm={perm}>{el}</RequirePerm>;

export default function App() {
  return (
    <Suspense fallback={<Spinner className="min-h-[50vh]" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="resources" element={<Resources />} />
          <Route path="labs/:id" element={<LabDetail />} />
          <Route path="equipment/:id" element={<EquipmentDetail />} />
          <Route path="book" element={guard('bookings.create', <BookingNew />)} />
          <Route path="finder" element={<Finder />} />
          <Route path="bookings" element={<MyBookings />} />
          <Route path="bookings/:id" element={<BookingDetail />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="occupancy" element={<Occupancy />} />
          <Route path="waitlist" element={<Waitlist />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="all-bookings" element={guard('bookings.view_all', <AllBookings />)} />
          <Route path="approvals" element={guard('bookings.approve', <Approvals />)} />
          <Route path="conflicts" element={guard('conflicts.resolve', <Conflicts />)} />
          <Route path="desk" element={guard('bookings.issue', <Desk />)} />
          <Route path="scan" element={guard('bookings.issue', <Scan />)} />
          <Route path="maintenance" element={guard('maintenance.manage', <Maintenance />)} />
          <Route path="analytics" element={guard('analytics.view', <Analytics />)} />
          <Route path="activity" element={guard('activity.view', <ActivityLog />)} />
          <Route path="rules" element={guard('rules.manage', <Rules />)} />
          <Route path="users" element={guard('users.manage', <UsersPage />)} />
          <Route path="catalog" element={guard('catalog.manage', <Catalog />)} />
          <Route path="permissions" element={guard('permissions.manage', <Permissions />)} />
          <Route
            path="*"
            element={
              <EmptyState
                title="Page not found"
                description="The page you are looking for doesn't exist."
                action={
                  <Link to="/">
                    <Button variant="secondary">Go to dashboard</Button>
                  </Link>
                }
              />
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}
