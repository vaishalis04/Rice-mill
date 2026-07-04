import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getVendorPortalById } from "../api";

export default function VendorPortalDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getVendorPortalById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
