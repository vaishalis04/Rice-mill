import { useEffect, useState } from "react";
import { getMachineManagementList } from "../api";

export default function MachineManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getMachineManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Machine Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
