import { useEffect, useState } from "react";
import { getQualityControlList } from "../api";

export default function QualityControlList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getQualityControlList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Quality Control</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
