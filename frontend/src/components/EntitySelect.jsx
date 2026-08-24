import { useState, useEffect, useRef, useMemo } from "react";
import { ENTITY_OPTIONS } from "../config/entityOptions";
import "./EntitySelect.css";

export default function EntitySelect({
  entity,
  label,
  value,
  onChange,
  required = false,
  placeholder = "Type to search…",
  filter,
  disabled = false,
  creatable = false,
  context = {},
  onCreated,
}) {
  const config = ENTITY_OPTIONS[entity];
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);

  const quickCreate = creatable ? config.quickCreate : null;
  const [creating, setCreating] = useState(false);
  const [createValues, setCreateValues] = useState({});
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  const missingContext = (quickCreate?.requiresContext || []).filter(
    (key) => context[key] === "" || context[key] == null
  );

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
  }, [entity]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        if (creating) return;
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [creating]);

  const selected = useMemo(
    () => options.find((o) => String(o.id) === String(value)),
    [options, value]
  );

  const visibleOptions = useMemo(
    () => (filter ? options.filter(filter) : options),
    [options, filter]
  );

  const filtered = useMemo(() => {
    if (!query) return visibleOptions;
    const q = query.toLowerCase();
    return visibleOptions.filter((o) =>
      config.getLabel(o).toLowerCase().includes(q)
    );
  }, [visibleOptions, query, config]);

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

  const startCreating = () => {
    const firstField = quickCreate.fields[0]?.name;
    setCreateValues(firstField ? { [firstField]: query } : {});
    setCreateError("");
    setCreating(true);
  };

  const handleCreateFieldChange = (name, val) =>
    setCreateValues((prev) => ({ ...prev, [name]: val }));

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setCreateError("");
    const missingField = quickCreate.fields.find(
      (f) => f.required && !String(createValues[f.name] ?? "").trim()
    );
    if (missingField) {
      setCreateError(`${missingField.label} is required`);
      return;
    }
    setCreateSubmitting(true);
    try {
      const payload = { ...createValues };
      quickCreate.fields
        .filter((f) => f.type === "number")
        .forEach((f) => {
          if (payload[f.name] !== "" && payload[f.name] != null) {
            payload[f.name] = Number(payload[f.name]);
          }
        });
     
      quickCreate.fields
        .filter((f) => f.type === "combo")
        .forEach((f) => {
          if (typeof payload[f.name] === "string") {
            payload[f.name] = payload[f.name].trim().toLowerCase();
          }
        });
      let newRow = await quickCreate.create(payload, context);

      if (!newRow || newRow.id == null) {
        const freshList = await config.fetch();
        const matchField = quickCreate.fields[0]?.name;
        const typedValue = payload[matchField];
        newRow =
          freshList.find((r) => String(r[matchField]) === String(typedValue)) ||
          freshList[freshList.length - 1];
        setOptions(freshList || []);
      } else {
        setOptions((prev) => [...prev, newRow]);
      }

      if (!newRow || newRow.id == null) {
        throw new Error(
          "Created it, but couldn't confirm the new record — please refresh and pick it from the list."
        );
      }

      onChange(newRow.id);
      onCreated?.(newRow);
      setCreating(false);
      setCreateValues({});
      setQuery("");
      setOpen(false);
    } catch (err) {
      setCreateError(
        err.response?.data?.msg ||
          err.response?.data?.message ||
          err.message ||
          "Couldn't create — check the details"
      );
    } finally {
      setCreateSubmitting(false);
    }
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
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setCreating(false);
          }}
          required={required}
          disabled={loading || disabled}
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
            {creating ? (
              <div className="es-create-panel">
                <div className="es-create-title">
                  New {quickCreate.label}
                </div>
                {quickCreate.fields.map((f) => (
                  <div className="es-create-field" key={f.name}>
                    <label>
                      {f.label}
                      {f.required ? " *" : ""}
                    </label>
                    {f.type === "select" ? (
                      <select
                        value={createValues[f.name] ?? ""}
                        onChange={(e) =>
                          handleCreateFieldChange(f.name, e.target.value)
                        }
                        autoFocus={f === quickCreate.fields[0]}
                      >
                        <option value="">
                          {f.placeholder || `Select ${f.label}…`}
                        </option>
                        {f.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "combo" ? (
                      <>
                        <input
                          type="text"
                          list={`es-combo-${entity}-${f.name}`}
                          value={createValues[f.name] ?? ""}
                          placeholder={f.placeholder || `Pick or type a new ${f.label.toLowerCase()}…`}
                          onChange={(e) =>
                            handleCreateFieldChange(f.name, e.target.value)
                          }
                          autoFocus={f === quickCreate.fields[0]}
                        />
                        <datalist id={`es-combo-${entity}-${f.name}`}>
                          {f.options.map((opt) => (
                            <option key={opt} value={opt} />
                          ))}
                        </datalist>
                      </>
                    ) : f.type === "entity" ? (
                      <EntitySelect
                        entity={f.entity}
                        value={createValues[f.name] ?? ""}
                        onChange={(id) => handleCreateFieldChange(f.name, id)}
                        required={f.required}
                        creatable={f.creatable}
                        placeholder={f.placeholder}
                      />
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : f.type || "text"}
                        value={createValues[f.name] ?? ""}
                        onChange={(e) =>
                          handleCreateFieldChange(f.name, e.target.value)
                        }
                        autoFocus={f === quickCreate.fields[0]}
                      />
                    )}
                  </div>
                ))}
                {createError && <div className="es-msg es-msg-error">{createError}</div>}
                <div className="es-create-actions">
                  <button
                    type="button"
                    className="es-create-save"
                    disabled={createSubmitting}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCreateSubmit}
                  >
                    {createSubmitting ? "Saving…" : `Save ${quickCreate.label}`}
                  </button>
                  <button
                    type="button"
                    className="es-create-cancel"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setCreating(false);
                      setCreateError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
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
                {quickCreate && !loadError && !loading && (
                  missingContext.length > 0 ? (
                    <div className="es-msg">
                      {quickCreate.requiresContextMessage ||
                        "Fill the required fields above first"}
                    </div>
                  ) : (
                    <div
                      className="es-option es-option-create"
                      onMouseDown={startCreating}
                    >
                      + Add new {quickCreate.label}
                      {query ? ` "${query}"` : ""}
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}