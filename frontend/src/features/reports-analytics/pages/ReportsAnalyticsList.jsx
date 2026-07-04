import { useEffect, useState } from "react";
import { getReportsAnalyticsList } from "../api";

export default function ReportsAnalyticsList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getReportsAnalyticsList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Reports Analytics</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
