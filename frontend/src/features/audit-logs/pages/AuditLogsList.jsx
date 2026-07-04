import { useEffect, useState } from "react";
import { getAuditLogsList } from "../api";

export default function AuditLogsList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getAuditLogsList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Audit Logs</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
