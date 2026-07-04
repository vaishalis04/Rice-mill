import { useEffect, useState } from "react";
import { getWarehouseManagementList } from "../api";

export default function WarehouseManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getWarehouseManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Warehouse Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
