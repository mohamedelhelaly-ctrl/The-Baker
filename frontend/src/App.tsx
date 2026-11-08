import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { GuestOnly } from "./components/auth/GuestOnly";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppShell } from "./components/layout/AppShell";
import { Loading } from "./components/ui/Loading";

const HomePage = lazy(() => import("./pages/home/HomePage"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/auth/ResetPasswordPage"));
const AccountPage = lazy(() => import("./pages/account/AccountPage"));
const NotFoundPage = lazy(() => import("./pages/errors/NotFoundPage"));

// All routes and guards live here. Later milestones add <RequireModule module="orders_queue"> groups.
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route element={<GuestOnly />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
          </Route>
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route path="account" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
