import { useEffect, useState } from "react";
import { getMasterSettingsList } from "../api";

export default function MasterSettingsList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getMasterSettingsList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Master Settings</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
