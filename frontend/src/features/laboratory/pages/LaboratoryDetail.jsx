import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getLaboratoryById } from "../api";

export default function LaboratoryDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getLaboratoryById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
