import "./styles/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import { Toaster } from "sonner";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/session";
import { AppShell } from "./components/AppShell";
import { LoadingBlock } from "./components/ui";
import { NotFound, RouteError } from "./pages/NotFound";

// Screens load on demand to keep the first download small.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Batches = lazy(() => import("./pages/Batches"));
const BatchForm = lazy(() => import("./pages/BatchForm"));
const BatchDetail = lazy(() => import("./pages/BatchDetail"));
const Labels = lazy(() => import("./pages/Labels"));
const Assignments = lazy(() => import("./pages/Assignments"));
const AssignmentDetail = lazy(() => import("./pages/AssignmentDetail"));
const Receiving = lazy(() => import("./pages/Receiving"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Team = lazy(() => import("./pages/Team"));
const Facilities = lazy(() => import("./pages/Facilities"));
const Settings = lazy(() => import("./pages/Settings"));
const Landing = lazy(() => import("./pages/Landing"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const AcceptInvite = lazy(() => import("./pages/auth/AcceptInvite"));
const Terms = lazy(() => import("./pages/auth/Terms"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Scan = lazy(() => import("./pages/Scan").then((m) => ({ default: m.Scan })));
const ScanResolver = lazy(() => import("./pages/Scan").then((m) => ({ default: m.ScanResolver })));
const Login = lazy(() => import("./pages/auth/Login").then((m) => ({ default: m.Login })));
const ForgotPassword = lazy(() => import("./pages/auth/Login").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/auth/Login").then((m) => ({ default: m.ResetPassword })));
const Tracking = lazy(() => import("./pages/Tracking"));
const Reports = lazy(() => import("./pages/Reports"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function FullPageLoading() {
  return (
    <div className="mx-auto max-w-3xl p-10">
      <LoadingBlock rows={5} />
    </div>
  );
}

/** Signed in with an active organization membership. */
function RequireMember({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!data.membership) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function RequireUser({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <FullPageLoading />;
  if (!data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <FullPageLoading />;
  if (data?.membership) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<LoadingBlock rows={6} />}>{node}</Suspense>;

const router = createBrowserRouter([
  { path: "/", element: <Landing />, errorElement: <RouteError /> },
  { path: "/login", element: <PublicOnly><Login /></PublicOnly> },
  { path: "/signup", element: <PublicOnly><Signup /></PublicOnly> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/invite/:token", element: <AcceptInvite /> },
  { path: "/terms", element: <Terms /> },
  { path: "/onboarding", element: <RequireUser><Onboarding /></RequireUser> },
  { path: "/s/:token", element: <RequireMember><ScanResolver /></RequireMember> },
  {
    element: (
      <RequireMember>
        <AppShell />
      </RequireMember>
    ),
    errorElement: <RouteError />,
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/batches", element: <Batches /> },
      { path: "/batches/new", element: <BatchForm /> },
      { path: "/batches/:id", element: <BatchDetail /> },
      { path: "/batches/:id/edit", element: <BatchForm /> },
      { path: "/batches/:id/labels", element: <Labels /> },
      { path: "/scan", element: <Scan /> },
      { path: "/tracking", element: lazyPage(<Tracking />) },
      { path: "/assignments", element: <Assignments /> },
      { path: "/assignments/:id", element: <AssignmentDetail /> },
      { path: "/receiving", element: <Receiving /> },
      { path: "/alerts", element: <Alerts /> },
      { path: "/reports", element: lazyPage(<Reports />) },
      { path: "/team", element: <Team /> },
      { path: "/facilities", element: <Facilities /> },
      { path: "/settings", element: <Settings /> },
      { path: "*", element: <NotFound inApp /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<FullPageLoading />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />
    </QueryClientProvider>
  </StrictMode>,
);
