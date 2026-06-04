import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/layout/AppShell";
import Login from "@/pages/Login";
import Pending from "@/pages/Pending";
import Overview from "@/pages/Overview";
import Monthly from "@/pages/Monthly";
import Daily from "@/pages/Daily";
import Categories from "@/pages/Categories";
import Budgets from "@/pages/Budgets";
import Transactions from "@/pages/Transactions";
import Settings, {
  CategoriesSettingsPage,
  AccountSettingsPage,
} from "@/pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pending" element={<Pending />} />
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="monthly" element={<Monthly />} />
        <Route path="daily" element={<Daily />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="categories" element={<Categories />} />
        <Route path="subscriptions" element={<Navigate to="/budgets" replace />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/categories" element={<CategoriesSettingsPage />} />
        <Route path="settings/account" element={<AccountSettingsPage />} />
      </Route>
    </Routes>
  );
}
