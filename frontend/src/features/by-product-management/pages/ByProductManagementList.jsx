import { useEffect, useState } from "react";
import { getByProductManagementList } from "../api";

export default function ByProductManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getByProductManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>By Product Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
