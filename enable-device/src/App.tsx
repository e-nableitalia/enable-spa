import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";

const AdminLayout         = lazy(() => import("./components/layout/AdminLayout"));
const VolunteerLayout     = lazy(() => import("./components/layout/VolunteerLayout"));
const Register            = lazy(() => import("./pages/Register"));
const CompleteRegistration = lazy(() => import("./pages/CompleteRegistration"));
const SetPassword         = lazy(() => import("./pages/SetPassword"));
const Home                = lazy(() => import("./pages/Home"));
const RequestDevice       = lazy(() => import("./pages/RequestDevice"));
const VolunteerConsentPage = lazy(() => import("./pages/VolunteerConsentPage"));

function PageLoader() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/request-device" element={<RequestDevice />} />
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="/volunteer/*" element={<VolunteerLayout />} />
          <Route path="/register" element={<Register />} />
          <Route path="/complete-registration" element={<CompleteRegistration />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/home" element={<Home />} />
          <Route path="/volunteer-consent" element={<VolunteerConsentPage />} />
          <Route path="*" element={<Login />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
