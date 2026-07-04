import { useState } from "react";
import { createQualityControl } from "../api";

export default function QualityControlForm() {
  const [formData, setFormData] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createQualityControl(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields go here */}
      <button type="submit">Save</button>
    </form>
  );
}
