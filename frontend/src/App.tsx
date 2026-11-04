import { Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import StyleGuidePage from './pages/StyleGuidePage';
import LoginPage from './pages/auth/LoginPage';
import RegisterCustomerPage from './pages/auth/RegisterCustomerPage';
import RegisterRiderPage from './pages/auth/RegisterRiderPage';
import VerifyPage from './pages/auth/VerifyPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import CustomerHome from './pages/customer/CustomerHome';
import RiderHome from './pages/rider/RiderHome';
import AdminHome from './pages/admin/AdminHome';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from './routes/guards';
import PortalPlaceholder from './pages/PortalPlaceholder';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/styleguide" element={<StyleGuidePage />} />

      {/* Authentication */}
      <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
      <Route path="/register" element={<RedirectIfAuthenticated><RegisterCustomerPage /></RedirectIfAuthenticated>} />
      <Route path="/register-rider" element={<RedirectIfAuthenticated><RegisterRiderPage /></RedirectIfAuthenticated>} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/forgot-password" element={<RedirectIfAuthenticated><ForgotPasswordPage /></RedirectIfAuthenticated>} />
      <Route path="/reset-password" element={<RedirectIfAuthenticated><ResetPasswordPage /></RedirectIfAuthenticated>} />

      {/* Customer portal */}
      <Route path="/app" element={<RequireAuth audience="CUSTOMER" />}>
        <Route index element={<CustomerHome />} />
        <Route path="book" element={<PortalPlaceholder portal="Customer" phase="Phase 3" scope={['Map-based booking with a server-calculated price']} />} />
        <Route path="deliveries" element={<PortalPlaceholder portal="Customer" phase="Phase 3" scope={['Delivery history and live tracking']} />} />
        <Route path="wallet" element={<PortalPlaceholder portal="Customer" phase="Phase 7" scope={['Wallet top-up and transaction history']} />} />
      </Route>

      {/* Rider portal */}
      <Route path="/rider" element={<RequireAuth audience="RIDER" />}>
        <Route index element={<RiderHome />} />
        <Route path="offers" element={<PortalPlaceholder portal="Rider" phase="Phase 4" scope={['Delivery offers with countdown']} />} />
        <Route path="active" element={<PortalPlaceholder portal="Rider" phase="Phase 4" scope={['Delivery workflow and proof of delivery']} />} />
        <Route path="earnings" element={<PortalPlaceholder portal="Rider" phase="Phase 4" scope={['Earnings, commission and withdrawals']} />} />
      </Route>

      {/* Admin portal */}
      <Route path="/admin" element={<RequireAuth audience="ADMIN" />}>
        <Route index element={<AdminHome />} />
        <Route path="deliveries" element={<PortalPlaceholder portal="Admin" phase="Phase 5" scope={['Delivery management and assignment']} />} />
        <Route path="riders" element={<PortalPlaceholder portal="Admin" phase="Phase 5" scope={['Rider approvals and performance']} />} />
        <Route path="finance" element={<PortalPlaceholder portal="Admin" phase="Phase 7" scope={['Ledger, withdrawals and refunds']} />} />
        {/* A permission-gated route: only staff who can read audits may open it */}
        <Route path="audit" element={<RequirePermission permission="audit:read" />}>
          <Route index element={<PortalPlaceholder portal="Admin" phase="Phase 5" scope={['Filterable audit trail UI (the API already exists at /admin/audit-logs)']} />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<PortalPlaceholder portal="Unknown" phase="—" scope={['The page you asked for does not exist.']} />}
      />
    </Routes>
  );
}
