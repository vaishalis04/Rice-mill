import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getGateManagementById } from "../api";

export default function GateManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getGateManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
