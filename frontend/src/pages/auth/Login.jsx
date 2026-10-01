import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getMyPermissionsApi } from "../../api/api";
import { ROLE_ROUTES, ROLE_HOME_MODULE, DEFAULT_ROUTE } from "../../constants/roles";
import "./Auth.css";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const user = await login(email, password);

      // A role's fixed dashboard (Warehouse, Sales, etc.) only ever renders
      // pages for its own module — so if this user has ALSO been granted
      // pages outside that module (e.g. a Warehouse user handed Lab Tests
      // or PO Approval individually — see Admin > User Approvals / Roles &
      // Permissions), those extras could never show up there no matter
      // what's granted. Send them to the general permission-driven
      // dashboard instead, which renders every page they've actually been
      // given, across every module — including their role's own pages, so
      // nothing is lost. A role with no extras outside its own module
      // keeps landing on its usual dashboard, exactly as before.
      let redirectTo = ROLE_ROUTES[user.role_id] || DEFAULT_ROUTE;
      const homeModule = ROLE_HOME_MODULE[user.role_id];
      if (homeModule) {
        try {
          const res = await getMyPermissionsApi();
          const data = res.data.data ?? res.data;
          const grantedModules = new Set((data.permissions || []).map((p) => p.module));
          const hasExtras = [...grantedModules].some((m) => m !== homeModule);
          if (hasExtras) redirectTo = DEFAULT_ROUTE;
        } catch {
          // If this check fails for any reason, fall back to the role's
          // usual dashboard rather than blocking login.
        }
      }

      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(
        err.response?.data?.message || "Invalid email/mobile no. or password. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1>Rice Mill Portal</h1>
        <p className="subtitle">Sign in to continue to your dashboard</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="email">Email or Mobile No.</label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>

            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="subtitle" style={{ marginTop: 16 }}>
          New here? <Link to="/register">Register</Link> — an admin will need to approve your access first.
        </p>
      </div>
    </div>
  );
}