import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getWeighbridgeById } from "../api";

export default function WeighbridgeDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getWeighbridgeById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
