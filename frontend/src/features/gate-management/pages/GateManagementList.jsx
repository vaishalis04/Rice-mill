import { useEffect, useState } from "react";
import { getGateManagementList } from "../api";

export default function GateManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getGateManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Gate Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
