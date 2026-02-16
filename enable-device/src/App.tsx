import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import AdminLayout from "./components/layout/AdminLayout";
import VolunteerLayout from "./components/layout/VolunteerLayout";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin/*" element={<AdminLayout />} />
        <Route path="/volunteer/*" element={<VolunteerLayout />} />
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
