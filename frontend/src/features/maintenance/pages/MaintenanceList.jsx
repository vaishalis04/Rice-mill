import { useEffect, useState } from "react";
import { getMaintenanceList } from "../api";

export default function MaintenanceList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getMaintenanceList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Maintenance</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
