import { useEffect, useState } from "react";
import { getDryerManagementList } from "../api";

export default function DryerManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getDryerManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Dryer Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
