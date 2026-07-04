import { useEffect, useState } from "react";
import { getSamplingList } from "../api";

export default function SamplingList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getSamplingList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Sampling</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
