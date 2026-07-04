import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getInventoryById } from "../api";

export default function InventoryDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getInventoryById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
