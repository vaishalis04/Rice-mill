import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPackingById } from "../api";

export default function PackingDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getPackingById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
