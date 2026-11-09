import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { GuestOnly } from "./components/auth/GuestOnly";
import { RequireAuth } from "./components/auth/RequireAuth";
import { RequireModule } from "./components/auth/RequireModule";
import { AppShell } from "./components/layout/AppShell";
import { Loading } from "./components/ui/Loading";

const HomePage = lazy(() => import("./pages/home/HomePage"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/auth/ResetPasswordPage"));
const AccountLayout = lazy(() => import("./pages/account/AccountLayout"));
const AccountPage = lazy(() => import("./pages/account/AccountPage"));
const AddressesPage = lazy(() => import("./pages/account/AddressesPage"));
const OrdersPage = lazy(() => import("./pages/account/OrdersPage"));
const MenuPage = lazy(() => import("./pages/menu/MenuPage"));
const ProductPage = lazy(() => import("./pages/menu/ProductPage"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminProductsPage = lazy(() => import("./pages/admin/AdminProductsPage"));
const AdminProductEditPage = lazy(() => import("./pages/admin/AdminProductEditPage"));
const AdminSchedulePage = lazy(() => import("./pages/admin/AdminSchedulePage"));
const AdminDeliveryZonesPage = lazy(() => import("./pages/admin/AdminDeliveryZonesPage"));
const CartPage = lazy(() => import("./pages/cart/CartPage"));
const CheckoutPage = lazy(() => import("./pages/checkout/CheckoutPage"));
const FakePayPage = lazy(() => import("./pages/payments/FakePayPage"));
const TrackPage = lazy(() => import("./pages/orders/TrackPage"));
const ChangeOrderPage = lazy(() => import("./pages/orders/ChangeOrderPage"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPaymentsPage"));
const AdminPoliciesPage = lazy(() => import("./pages/admin/AdminPoliciesPage"));
const DeliveryPage = lazy(() => import("./pages/delivery/DeliveryPage"));
const AdminTaxonomyPage = lazy(() => import("./pages/admin/AdminTaxonomyPage"));
const StaffLayout = lazy(() => import("./pages/staff/StaffLayout"));
const StaffQueuePage = lazy(() => import("./pages/staff/StaffQueuePage"));
const StaffOrderPage = lazy(() => import("./pages/staff/StaffOrderPage"));
const StaffPrepSheetPage = lazy(() => import("./pages/staff/StaffPrepSheetPage"));
const NotFoundPage = lazy(() => import("./pages/errors/NotFoundPage"));

// All routes and guards live here: one <RequireModule> group per permission module.
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="products/:slug" element={<ProductPage />} />
          <Route path="delivery" element={<DeliveryPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="track/:code" element={<TrackPage />} />
          <Route path="track/:code/change" element={<ChangeOrderPage />} />
          <Route path="fake-pay/:code" element={<FakePayPage />} />
          <Route element={<GuestOnly />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route path="account" element={<AccountLayout />}>
              <Route index element={<AccountPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="addresses" element={<AddressesPage />} />
            </Route>
            <Route element={<RequireModule module="orders_queue" />}>
              <Route path="staff" element={<StaffLayout />}>
                <Route path="orders" element={<StaffQueuePage />} />
                <Route path="orders/:id" element={<StaffOrderPage />} />
                <Route path="prep-sheet" element={<StaffPrepSheetPage />} />
              </Route>
            </Route>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={null} />
              <Route element={<RequireModule module="catalog_admin" />}>
                <Route path="products" element={<AdminProductsPage />} />
                <Route path="products/new" element={<AdminProductEditPage />} />
                <Route path="products/:id" element={<AdminProductEditPage />} />
                <Route path="categories" element={<AdminTaxonomyPage kind="categories" />} />
                <Route path="occasions" element={<AdminTaxonomyPage kind="occasions" />} />
              </Route>
              <Route element={<RequireModule module="schedule_admin" />}>
                <Route path="schedule" element={<AdminSchedulePage />} />
                <Route path="delivery-zones" element={<AdminDeliveryZonesPage />} />
              </Route>
              <Route element={<RequireModule module="settings" />}>
                <Route path="payments" element={<AdminPaymentsPage />} />
                <Route path="policies" element={<AdminPoliciesPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
