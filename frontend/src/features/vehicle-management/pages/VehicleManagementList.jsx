import { useEffect, useState } from "react";
import { getVehicleManagementList } from "../api";

export default function VehicleManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getVehicleManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Vehicle Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
