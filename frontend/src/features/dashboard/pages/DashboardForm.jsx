import { useState } from "react";
import { createDashboard } from "../api";

export default function DashboardForm() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createDashboard(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
