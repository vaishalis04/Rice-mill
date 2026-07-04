import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getMachineManagementById } from "../api";

export default function MachineManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getMachineManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
