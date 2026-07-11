import { useState, useEffect, useRef, useMemo } from "react";
import { ENTITY_OPTIONS } from "../config/entityOptions";
import "./EntitySelect.css";

/**
 * Searchable dropdown for any "pick an ID from another table" field.
 *
 * <EntitySelect
 *   entity="vendor"              // key into ENTITY_OPTIONS
 *   label="Vendor"
 *   value={form.vendor_id}       // the id currently stored on the form
 *   onChange={(id) => setForm({ ...form, vendor_id: id })}
 *   required
 * />
 *
 * The user types to search by name/code, clicks a row, and onChange
 * fires with that row's numeric id — the payload still just gets an id,
 * the person just never has to know or type it.
 */
export default function EntitySelect({
  entity,
  label,
  value,
  onChange,
  required = false,
  placeholder = "Type to search…",
}) {
  const config = ENTITY_OPTIONS[entity];
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    config
      .fetch()
      .then((rows) => {
        if (alive) setOptions(rows || []);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

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
    return options.filter((o) => config.getLabel(o).toLowerCase().includes(q));
  }, [options, query, config]);

  const handleSelect = (row) => {
    onChange(row.id);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
  };

  const displayValue = open ? query : selected ? config.getLabel(selected) : "";

  return (
    <div className="es-field" ref={boxRef}>
      {label && <label>{label}</label>}
      <div className="es-box">
        <input
          type="text"
          value={displayValue}
          placeholder={loading ? "Loading…" : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          required={required}
          disabled={loading}
          autoComplete="off"
        />
        {value !== "" && value != null && (
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
            {loadError && (
              <div className="es-msg">Failed to load options</div>
            )}
            {!loadError && !loading && filtered.length === 0 && (
              <div className="es-msg">No matches</div>
            )}
            {!loadError &&
              filtered.map((row) => (
                <div
                  key={row.id}
                  className={`es-option${
                    String(row.id) === String(value) ? " active" : ""
                  }`}
                  onMouseDown={() => handleSelect(row)}
                >
                  <span>{config.getLabel(row)}</span>
                  <span className="es-id">#{row.id}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
