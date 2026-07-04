import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getMasterSettingsById } from "../api";

export default function MasterSettingsDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);

  useEffect(() => {
    getMasterSettingsById(id).then((res) => setItem(res.data?.data));
  }, [id]);

  return <div>{/* Detail view for {id} */}</div>;
}
