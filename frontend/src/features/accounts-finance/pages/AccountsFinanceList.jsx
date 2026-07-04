import { useEffect, useState } from "react";
import { getAccountsFinanceList } from "../api";

export default function AccountsFinanceList() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    getAccountsFinanceList().then((res) => setItems(res.data?.data || []));
  }, []);

  return (
    <div>
      <h2>Accounts Finance</h2>
      {/* Table / list UI goes here */}
    </div>
  );
}
