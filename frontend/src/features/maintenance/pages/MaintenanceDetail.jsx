import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getMaintenanceById } from "../api";

export default function MaintenanceDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getMaintenanceById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
