import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getVehicleManagementById } from "../api";

export default function VehicleManagementDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getVehicleManagementById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
