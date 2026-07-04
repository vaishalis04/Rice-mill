import { useEffect, useState } from "react";
import { getGpsTrackingList } from "../api";

export default function GpsTrackingList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getGpsTrackingList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Gps Tracking</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
