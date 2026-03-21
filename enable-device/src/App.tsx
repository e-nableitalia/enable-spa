import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import AdminLayout from "./components/layout/AdminLayout";
import VolunteerLayout from "./components/layout/VolunteerLayout";
import Register from "./pages/Register";
import CompleteRegistration from "./pages/CompleteRegistration";
import SetPassword from "./pages/SetPassword";
import Home from "./pages/Home";
import RequestDevice from "./pages/RequestDevice";
import VolunteerConsentPage from "./pages/VolunteerConsentPage";

export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}
