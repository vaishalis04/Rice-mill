import { useEffect, useState } from "react";
import { getProductionList } from "../api";

export default function ProductionList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getProductionList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Production</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
