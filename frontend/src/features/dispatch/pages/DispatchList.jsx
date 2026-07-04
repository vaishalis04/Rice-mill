import { useEffect, useState } from "react";
import { getDispatchList } from "../api";

export default function DispatchList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getDispatchList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Dispatch</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
