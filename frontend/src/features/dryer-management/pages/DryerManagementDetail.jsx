import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getDryerManagementById } from "../api";

export default function DryerManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getDryerManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
