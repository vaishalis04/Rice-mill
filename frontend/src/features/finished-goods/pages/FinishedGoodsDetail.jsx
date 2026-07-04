import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getFinishedGoodsById } from "../api";

export default function FinishedGoodsDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getFinishedGoodsById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
