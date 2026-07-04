import { useEffect, useState } from "react";
import { getSalesOrderList } from "../api";

export default function SalesOrderList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getSalesOrderList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Sales Order</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
