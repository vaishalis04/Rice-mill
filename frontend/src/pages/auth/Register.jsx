import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { submitRegistrationRequestApi } from "../../api/api";
import "./Auth.css";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", mobile: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await submitRegistrationRequestApi({
        name: form.name,
        mobile: form.mobile,
        email: form.email,
        password: form.password,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't submit your request. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1>Request Submitted</h1>
          <p className="subtitle">
            Thanks, {form.name}. An admin needs to approve your request before you can log in — you'll be able to
            sign in with your mobile number ({form.mobile}) and the password you just set once that's done.
          </p>
          <button className="auth-submit" onClick={() => navigate("/login", { replace: true })}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1>Create Account</h1>
        <p className="subtitle">Submit your details — an admin will review and approve your access.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" value={form.name} onChange={handleChange} required autoFocus />
          </div>

          <div className="auth-field">
            <label htmlFor="mobile">Mobile No.</label>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              value={form.mobile}
              onChange={handleChange}
              required
              placeholder="You'll log in with this number"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />
          </div>

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for Approval"}
          </button>
        </form>

        <p className="subtitle" style={{ marginTop: 16 }}>
          Already have an approved account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}