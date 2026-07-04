import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getVendorManagementById } from "../api";

export default function VendorManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getVendorManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
