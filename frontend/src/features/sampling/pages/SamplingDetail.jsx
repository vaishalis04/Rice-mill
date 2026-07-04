import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSamplingById } from "../api";

export default function SamplingDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getSamplingById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
