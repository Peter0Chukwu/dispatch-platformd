import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { FullPageLoader } from "./components/ui";
import LandingPage from "./pages/LandingPage";
import StyleGuidePage from "./pages/StyleGuidePage";
import LoginPage from "./pages/auth/LoginPage";
import RegisterCustomerPage from "./pages/auth/RegisterCustomerPage";
import RegisterRiderPage from "./pages/auth/RegisterRiderPage";
import VerifyPage from "./pages/auth/VerifyPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import TrackPage from "./pages/TrackPage";
import CustomerHome from "./pages/customer/CustomerHome";
import BookDeliveryPage from "./pages/customer/BookDeliveryPage";
import DeliveriesPage from "./pages/customer/DeliveriesPage";
import DeliveryDetailPage from "./pages/customer/DeliveryDetailPage";
import RiderHome from "./pages/rider/RiderHome";
import RiderOffersPage from "./pages/rider/OffersPage";
import RiderActiveJobPage from "./pages/rider/ActiveJobPage";
import RiderEarningsPage from "./pages/rider/EarningsPage";
import RiderDocumentsPage from "./pages/rider/DocumentsPage";
/**
 * The admin screens are loaded on demand: they pull in Recharts, which nobody
 * signing in as a customer or rider should have to download. Each becomes its
 * own chunk instead of doubling the entry bundle.
 */
const AdminHome = lazy(() => import("./pages/admin/AdminHome"));
const AdminDeliveriesPage = lazy(() => import("./pages/admin/DeliveriesPage"));
const AdminDispatchBoardPage = lazy(() => import("./pages/admin/DispatchBoardPage"));
const AdminRidersPage = lazy(() => import("./pages/admin/RidersPage"));
const AdminCustomersPage = lazy(() => import("./pages/admin/CustomersPage"));
const AdminPricingPage = lazy(() => import("./pages/admin/PricingPage"));
const AdminStaffPage = lazy(() => import("./pages/admin/StaffPage"));
const AdminAuditPage = lazy(() => import("./pages/admin/AuditPage"));
const AdminFinancePage = lazy(() => import("./pages/admin/FinancePage"));
const AdminLiveMapPage = lazy(() => import("./pages/admin/LiveMapPage"));
const CustomerWalletPage = lazy(() => import("./pages/customer/WalletPage"));
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
} from "./routes/guards";
import PortalPlaceholder from "./pages/PortalPlaceholder";

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader label="Loading…" />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/styleguide" element={<StyleGuidePage />} />

        {/* Authentication */}
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthenticated>
              <RegisterCustomerPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/register-rider"
          element={
            <RedirectIfAuthenticated>
              <RegisterRiderPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route path="/verify" element={<VerifyPage />} />
        {/* Public tracking: the share link is the credential, so no auth wrapper. */}
        <Route path="/track/:token" element={<TrackPage />} />
        <Route
          path="/forgot-password"
          element={
            <RedirectIfAuthenticated>
              <ForgotPasswordPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/reset-password"
          element={
            <RedirectIfAuthenticated>
              <ResetPasswordPage />
            </RedirectIfAuthenticated>
          }
        />

        {/* Customer portal */}
        <Route path="/app" element={<RequireAuth audience="CUSTOMER" />}>
          <Route index element={<CustomerHome />} />
          <Route path="book" element={<BookDeliveryPage />} />
          <Route path="deliveries" element={<DeliveriesPage />} />
          <Route path="deliveries/:id" element={<DeliveryDetailPage />} />
          <Route path="wallet" element={<CustomerWalletPage />} />
        </Route>

        {/* Rider portal */}
        <Route path="/rider" element={<RequireAuth audience="RIDER" />}>
          <Route index element={<RiderHome />} />
          <Route path="offers" element={<RiderOffersPage />} />
          <Route path="active" element={<RiderActiveJobPage />} />
          <Route path="earnings" element={<RiderEarningsPage />} />
          <Route path="documents" element={<RiderDocumentsPage />} />
        </Route>

        {/* Admin portal */}
        <Route path="/admin" element={<RequireAuth audience="ADMIN" />}>
          <Route index element={<AdminHome />} />
          {/* Each screen sits behind the permission its API routes demand. */}
          <Route element={<RequirePermission permission="delivery:read" />}>
            <Route path="deliveries" element={<AdminDeliveriesPage />} />
            <Route path="dispatch" element={<AdminDispatchBoardPage />} />
          </Route>
          <Route element={<RequirePermission permission="tracking:read" />}>
            <Route path="map" element={<AdminLiveMapPage />} />
          </Route>
          <Route element={<RequirePermission permission="rider:read" />}>
            <Route path="riders" element={<AdminRidersPage />} />
          </Route>
          <Route element={<RequirePermission permission="customer:read" />}>
            <Route path="customers" element={<AdminCustomersPage />} />
          </Route>
          <Route element={<RequirePermission permission="pricing:read" />}>
            <Route path="pricing" element={<AdminPricingPage />} />
          </Route>
          <Route element={<RequirePermission permission="staff:read" />}>
            <Route path="staff" element={<AdminStaffPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit:read" />}>
            <Route path="audit" element={<AdminAuditPage />} />
          </Route>
          {/* Every number on the finance screen comes from the ledger, so it sits
            behind the same permission its API routes demand. */}
          <Route element={<RequirePermission permission="finance:read" />}>
            <Route path="finance" element={<AdminFinancePage />} />
          </Route>
        </Route>

        <Route
          path="*"
          element={
            <PortalPlaceholder
              portal="Unknown"
              phase="—"
              scope={["The page you asked for does not exist."]}
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
