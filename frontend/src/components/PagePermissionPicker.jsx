import { PAGE_CATALOG_BY_GROUP, permissionCode } from "../config/pageCatalog";

// `selectedCodes` — a Set of "module.page" codes currently checked.
// `onChange` — called with the new Set whenever something's toggled.
export default function PagePermissionPicker({ selectedCodes, onChange }) {
  const toggleOne = (code) => {
    const next = new Set(selectedCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const toggleGroup = (pages, allChecked) => {
    const next = new Set(selectedCodes);
    pages.forEach((p) => {
      const code = permissionCode(p.module, p.page);
      if (allChecked) next.delete(code);
      else next.add(code);
    });
    onChange(next);
  };

  return (
    <div>
      {Object.entries(PAGE_CATALOG_BY_GROUP).map(([group, pages]) => {
        const codes = pages.map((p) => permissionCode(p.module, p.page));
        const allChecked = codes.every((c) => selectedCodes.has(c));
        const singlePage = pages.length === 1;

        return (
          <div key={group} style={{ marginBottom: 10 }}>
            {singlePage ? (
              // A one-page group (e.g. "Gate" → just Gate Entry) doesn't
              // need its own "select all" — the one checkbox already does that.
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
                <input type="checkbox" checked={allChecked} onChange={() => toggleGroup(pages, allChecked)} />
                {group}
              </label>
            ) : (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
                  <input type="checkbox" checked={allChecked} onChange={() => toggleGroup(pages, allChecked)} />
                  {group} — All
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginLeft: 24, marginTop: 4 }}>
                  {pages.map((p) => {
                    const code = permissionCode(p.module, p.page);
                    return (
                      <label key={code} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <input type="checkbox" checked={selectedCodes.has(code)} onChange={() => toggleOne(code)} />
                        {p.label}
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}