import { useEffect, useState } from "react";
import { getNotificationsList } from "../api";

export default function NotificationsList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getNotificationsList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Notifications</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
