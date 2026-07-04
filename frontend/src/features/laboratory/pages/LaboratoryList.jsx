import { useEffect, useState } from "react";
import { getLaboratoryList } from "../api";

export default function LaboratoryList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getLaboratoryList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Laboratory</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
