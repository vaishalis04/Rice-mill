import { useState } from "react";
import { createLaboratory } from "../api";

export default function LaboratoryForm() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createLaboratory(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
