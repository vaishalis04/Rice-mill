import { useState } from "react";
import { createProduction } from "../api";

export default function ProductionForm() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createProduction(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
