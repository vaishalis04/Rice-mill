import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getAccountsFinanceById } from "../api";

export default function AccountsFinanceDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getAccountsFinanceById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
