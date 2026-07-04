import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getAuditLogsById } from "../api";

export default function AuditLogsDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getAuditLogsById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
