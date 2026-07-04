import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getGpsTrackingById } from "../api";

export default function GpsTrackingDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getGpsTrackingById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
