import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPurchaseManagementById } from "../api";

export default function PurchaseManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getPurchaseManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
