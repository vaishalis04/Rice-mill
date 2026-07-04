import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getDispatchById } from "../api";

export default function DispatchDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getDispatchById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
