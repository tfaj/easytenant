import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { EmptyState, Spinner } from "./components/ui";
import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";
import ForgotPassword from "./pages/auth/ForgotPassword";
import AuthAction from "./pages/auth/AuthAction";
import Join from "./pages/auth/Join";
import VerifyEmail from "./pages/auth/VerifyEmail";
import Home from "./pages/Home";

// Less-visited pages load on demand to keep the first download small.
const FaultsPage = lazy(() => import("./pages/faults/FaultsPage"));
const NewFault = lazy(() => import("./pages/faults/NewFault"));
const FaultDetail = lazy(() => import("./pages/faults/FaultDetail"));
const DevelopmentsPage = lazy(() => import("./pages/developments/DevelopmentsPage"));
const DevelopmentDetail = lazy(() => import("./pages/developments/DevelopmentDetail"));
const TenantsPage = lazy(() => import("./pages/TenantsPage"));
const PeoplePage = lazy(() => import("./pages/admin/PeoplePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function Boot() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <img src="/logo-mark.svg" alt="EasyTenant" className="size-10 animate-pulse" />
    </div>
  );
}

function RequireAuth() {
  const { firebaseUser, loading, emailVerified } = useAuth();
  const loc = useLocation();
  if (loading) return <Boot />;
  if (!firebaseUser) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!emailVerified) return <VerifyEmail />;
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

function Gate({ when, children }: { when: (c: ReturnType<typeof useAuth>["caps"]) => boolean; children: ReactNode }) {
  const { caps } = useAuth();
  return when(caps) ? <>{children}</> : <Navigate to="/" replace />;
}

function NotFound() {
  return <EmptyState title="Page not found">The link may be old. Use the menu to find your way.</EmptyState>;
}

const router = createBrowserRouter([
  { path: "/signin", element: <SignIn /> },
  { path: "/login", element: <Navigate to="/signin" replace /> },
  { path: "/signup", element: <SignUp /> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/auth/action", element: <AuthAction /> },
  { path: "/join/:code", element: <Join /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/faults", element: <FaultsPage /> },
      { path: "/faults/new", element: <Gate when={(c) => c.tenant || c.manager}><NewFault /></Gate> },
      { path: "/faults/:id", element: <FaultDetail /> },
      { path: "/developments", element: <Gate when={(c) => c.manager || c.createDevelopment}><DevelopmentsPage /></Gate> },
      { path: "/developments/:id", element: <DevelopmentDetail /> },
      { path: "/tenants", element: <Gate when={(c) => c.manager}><TenantsPage /></Gate> },
      { path: "/people", element: <Gate when={(c) => c.platformAdmin}><PeoplePage /></Gate> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
