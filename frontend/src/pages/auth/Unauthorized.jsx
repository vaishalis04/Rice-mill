import { Link } from "react-router-dom";
import "./Auth.css";

export default function Unauthorized() {
  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <h1>403 — Not Allowed</h1>
        <p className="subtitle">Your account doesn't have access to this page.</p>
        <Link to="/login" style={{ color: "#b5623a" }}>
          Back to login
        </Link>
      </div>
    </div>
  );
}
