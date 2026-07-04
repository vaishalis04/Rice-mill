import { useEffect, useState } from "react";
import { getNegotiationList } from "../api";

export default function NegotiationList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getNegotiationList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Negotiation</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
