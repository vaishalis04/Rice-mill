import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getNegotiationById } from "../api";

export default function NegotiationDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getNegotiationById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
