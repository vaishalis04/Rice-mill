import { useEffect, useState } from "react";
import { getUserManagementList } from "../api";

export default function UserManagementList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getUserManagementList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>User Management</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
