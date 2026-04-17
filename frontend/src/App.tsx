import { Route, Routes } from "react-router-dom";
import AppShell from "@/layout/AppShell";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Monthly from "@/pages/Monthly";
import Daily from "@/pages/Daily";
import Categories from "@/pages/Categories";
import Subscriptions from "@/pages/Subscriptions";
import Transactions from "@/pages/Transactions";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="monthly" element={<Monthly />} />
        <Route path="daily" element={<Daily />} />
        <Route path="categories" element={<Categories />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
