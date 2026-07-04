import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getWarehouseManagementById } from "../api";

export default function WarehouseManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getWarehouseManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
