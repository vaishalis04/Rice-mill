import { useEffect, useState } from "react";
import { getVendorPortalList } from "../api";

export default function VendorPortalList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getVendorPortalList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Vendor Portal</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
