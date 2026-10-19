import "./styles/index.css";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import { Toaster, toast } from "sonner";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/session";
import { AppShell } from "./components/AppShell";
import { LoadingBlock } from "./components/ui";
import { SignedInNotice } from "./components/SignedInNotice";
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
const Notifications = lazy(() => import("./pages/Notifications"));
const BatchQr = lazy(() => import("./pages/BatchQr"));
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
const DemoLabels = lazy(() => import("./pages/DemoLabels"));
const Tracking = lazy(() => import("./pages/Tracking"));
const Reports = lazy(() => import("./pages/Reports"));
const Approvals = lazy(() => import("./pages/Approvals"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const EnterInvite = lazy(() => import("./pages/auth/AcceptInvite").then((m) => ({ default: m.EnterInvite })));

/** The session ended (expired, signed out elsewhere) while the app was open: go back to sign-in instead of showing errors everywhere. */
function onApiError(err: unknown) {
  if (err instanceof ApiError && err.status === 401 && err.code === "unauthorized" && queryClient.getQueryData(["me"])) {
    queryClient.setQueryData(["me"], null); // RequireMember then redirects to /login?next=<this page>
    toast.error("Your session has ended. Please sign in again.", { id: "session-ended" });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
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

/** Signed in with an active membership of an APPROVED organization. */
function RequireMember({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!data.membership) return <Navigate to="/onboarding" replace />;
  if (data.membership.orgStatus !== "approved") return <PendingApproval />; // registration under platform review (or rejected)
  return <>{children}</>;
}

function RequireUser({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <FullPageLoading />;
  if (!data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Organization approvals: org admins who hold the separate review permission (the API enforces it too). */
function RequireReviewer({ children }: { children: ReactNode }) {
  const { data } = useMe();
  if (!data?.membership || data.membership.role !== "admin" || !data.user.canReviewOrganizations) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Sign-in and sign-up pages stay reachable while signed in (a stale session must never hide them).
 * A slim notice says who is signed in; submitting either form replaces that session.
 */
function PublicOnly({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <FullPageLoading />;
  return (
    <>
      {data?.membership && <SignedInNotice name={data.user.fullName} />}
      {children}
    </>
  );
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<LoadingBlock rows={6} />}>{node}</Suspense>;

const router = createBrowserRouter([
  { path: "/", element: <Landing />, errorElement: <RouteError /> },
  { path: "/login", element: <PublicOnly><Login /></PublicOnly> },
  { path: "/signup", element: <PublicOnly><Signup /></PublicOnly> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/invite", element: <EnterInvite /> },
  { path: "/invite/:token", element: <AcceptInvite /> },
  { path: "/platform", element: <Navigate to="/approvals" replace /> },
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
      { path: "/batches/:id/qr", element: <BatchQr /> },
      { path: "/scan", element: <Scan /> },
      { path: "/demo-labels", element: <DemoLabels /> },
      { path: "/tracking", element: lazyPage(<Tracking />) },
      { path: "/assignments", element: <Assignments /> },
      { path: "/assignments/:id", element: <AssignmentDetail /> },
      { path: "/receiving", element: <Receiving /> },
      { path: "/notifications", element: <Notifications /> },
      { path: "/alerts", element: <Navigate to="/notifications" replace /> },
      { path: "/reports", element: lazyPage(<Reports />) },
      { path: "/approvals", element: <RequireReviewer><Approvals /></RequireReviewer> },
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
