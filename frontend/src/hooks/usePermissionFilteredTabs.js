import { useEffect, useState } from "react";
import { getMyPermissionsApi } from "../api/api";

// Filters a dashboard's TABS array down to whatever the logged-in user's
// role (+ any direct per-user grants) has actually been given on the Admin
// > Roles & Permissions page, matching by `code` = "<module>.<page>".
//
// Backward-compatible by design: if this user's effective permissions
// don't include ANY of this dashboard's tab codes, every tab is shown
// (exactly today's behavior) — a role only starts being filtered once an
// admin has deliberately granted it specific pages. So every existing
// dashboard keeps working unchanged until someone opts a role into
// page-level control.
//
// `tabs` — the dashboard's usual TABS array, each item optionally carrying
// a `code` field ("module.page", from config/pageCatalog.js). Tabs with no
// `code` are always shown (can't be restricted).
export function usePermissionFilteredTabs(tabs) {
  const [grantedCodes, setGrantedCodes] = useState(null); // null = not loaded yet

  useEffect(() => {
    let cancelled = false;
    getMyPermissionsApi()
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data ?? res.data;
        setGrantedCodes(new Set((data.permissions || []).map((p) => p.code)));
      })
      .catch(() => {
        if (!cancelled) setGrantedCodes(new Set()); // fail open — see below
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (grantedCodes === null) return tabs; // still loading — show everything briefly rather than flash empty

  const relevantCodes = tabs.map((t) => t.code).filter(Boolean);
  const anyGranted = relevantCodes.some((c) => grantedCodes.has(c));
  if (!anyGranted) return tabs; // this role hasn't been curated — unfiltered, same as before

  return tabs.filter((t) => !t.code || grantedCodes.has(t.code));
}