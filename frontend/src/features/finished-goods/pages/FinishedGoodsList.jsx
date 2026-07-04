import { useEffect, useState } from "react";
import { getFinishedGoodsList } from "../api";

export default function FinishedGoodsList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getFinishedGoodsList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Finished Goods</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
