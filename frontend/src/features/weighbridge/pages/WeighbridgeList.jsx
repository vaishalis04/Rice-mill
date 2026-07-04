import { useEffect, useState } from "react";
import { getWeighbridgeList } from "../api";

export default function WeighbridgeList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getWeighbridgeList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Weighbridge</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
