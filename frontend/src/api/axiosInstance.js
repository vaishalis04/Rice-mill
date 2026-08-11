import axios from "axios";

// Set VITE_API_BASE_URL in a .env file to override this
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach token from localStorage on every request
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Auto-logout on 401 (expired/invalid token) + normalize error message field.
// Backend sends errors as { success: false, msg: "..." } (see app.js's global
// error handler), but every page's .catch() reads err.response.data.message.
// Rather than fix that in 20+ files, we mirror msg -> message here once.
// IMPORTANT: this file has been overwritten/reverted before — if error
// banners across the app start showing generic fallback text again instead
// of specific backend reasons, check this file first.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.data && error.response.data.message === undefined) {
      error.response.data.message = error.response.data.msg;
    }

    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;