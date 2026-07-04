import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getNotificationsById } from "../api";

export default function NotificationsDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getNotificationsById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
