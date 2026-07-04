import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getUserManagementById } from "../api";

export default function UserManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getUserManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
