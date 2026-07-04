import { useEffect, useState } from "react";
import { getInventoryList } from "../api";

export default function InventoryList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getInventoryList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Inventory</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
