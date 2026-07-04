import { useEffect, useState } from "react";
import { getPackingList } from "../api";

export default function PackingList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getPackingList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Packing</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
