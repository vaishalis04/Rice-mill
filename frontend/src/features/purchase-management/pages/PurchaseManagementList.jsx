import { useEffect, useState } from "react";
import { getPurchaseManagementList } from "../api";

export default function PurchaseManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getPurchaseManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Purchase Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
