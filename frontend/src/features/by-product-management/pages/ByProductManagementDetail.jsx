import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getByProductManagementById } from "../api";

export default function ByProductManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getByProductManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
