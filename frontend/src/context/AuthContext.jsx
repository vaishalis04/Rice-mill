import { createContext, useContext, useState, useEffect } from "react";
import { loginApi, logoutApi, getCurrentUserApi } from "../api/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On app load, restore session from localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const token = localStorage.getItem("token");

    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
      // Optional: verify token is still valid with the backend.
      // EDIT/remove this if your backend has no GET /auth/me route —
      // it wasn't in the contract you shared, so this may 404 harmlessly.
      getCurrentUserApi()
        .then((res) => {
          const freshUser = res.data.user ?? res.data;
          setUser(freshUser);
          localStorage.setItem("user", JSON.stringify(freshUser));
        })
        .catch(() => {
          // token invalid/expired — axiosInstance interceptor will redirect
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await loginApi(email, password);
    // Matches your real backend's response shape:
    // { success, accessToken, refreshToken, user: { id, username, email, role_id, plant_id } }
    const { accessToken, refreshToken, user: loggedInUser } = res.data;

    localStorage.setItem("token", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    localStorage.setItem("user", JSON.stringify(loggedInUser));
    setUser(loggedInUser);

    return loggedInUser;
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch {
      // ignore network errors on logout, clear client state anyway
    }
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
