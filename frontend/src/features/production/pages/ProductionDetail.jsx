import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getProductionById } from "../api";

export default function ProductionDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getProductionById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
