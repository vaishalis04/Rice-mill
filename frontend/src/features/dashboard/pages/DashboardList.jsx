import { useEffect, useState } from "react";
import { getDashboardList } from "../api";

export default function DashboardList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getDashboardList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
