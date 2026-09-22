import { useState, useEffect, useRef, useMemo } from "react";
import "./EntitySelect.css";

// Same search-bar-plus-dropdown UX as EntitySelect (reuses its CSS), but
// takes a plain `options` array directly instead of fetching from a fixed
// entity config. Use this wherever the choices depend on something else in
// the page (a selected warehouse's live stock, a batch's reserved
// materials, etc.) rather than the full master list.
//
// options: [{ id, label, sublabel? }]
export default function InlineSearchSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = "Type to search…",
  required = false,
  disabled = false,
  emptyMessage = "No matches",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = useMemo(
    () => options.find((o) => String(o.id) === String(value)),
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel || "").toLowerCase().includes(q)
    );
  }, [options, query]);

  const handleSelect = (opt) => {
    onChange(String(opt.id));
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
  };

  const displayValue = open ? query : selected ? selected.label : "";

  return (
    <div className="es-field" ref={boxRef}>
      {label && <label>{label}</label>}
      <div className="es-box">
        <input
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          required={required}
          disabled={disabled}
          autoComplete="off"
        />
        {!disabled && value !== "" && value != null && (
          <button
            type="button"
            className="es-clear"
            onClick={handleClear}
            tabIndex={-1}
            title="Clear"
          >
            ×
          </button>
        )}
        {open && (
          <div className="es-dropdown">
            {filtered.length === 0 && <div className="es-msg">{emptyMessage}</div>}
            {filtered.map((opt) => (
              <div
                key={opt.id}
                className={`es-option${String(opt.id) === String(value) ? " active" : ""}`}
                onMouseDown={() => handleSelect(opt)}
              >
                <span>{opt.label}</span>
                {opt.sublabel && <span className="es-id">{opt.sublabel}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}