import { useEffect, useState } from "react";
import { getVendorManagementList } from "../api";

export default function VendorManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getVendorManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Vendor Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
