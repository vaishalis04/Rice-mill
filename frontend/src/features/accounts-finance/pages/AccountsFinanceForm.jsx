import { useState } from "react";
import { createAccountsFinance } from "../api";

export default function AccountsFinanceForm() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createAccountsFinance(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
