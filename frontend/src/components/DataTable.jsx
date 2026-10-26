import "./DataTable.css";

/**
 * Generic list table.
 * columns: [{ key: "name", label: "Name" }, ...]
 * rows: array of objects
 * onEdit / onDelete: optional (id, row) => void handlers; omit to hide the column
 * showEdit / showDelete: optional (row) => boolean — hide that button on rows where it
 *   returns false (default: shown on every row, as before)
 * extraActions: optional (row) => node — extra buttons rendered in the Actions cell
 *   (e.g. a Cancel button), before Edit / Delete
 */
export default function DataTable({ columns, rows, onEdit, onDelete, showEdit, showDelete, extraActions, loading }) {
  const hasActions = Boolean(onEdit || onDelete || extraActions);
  if (loading) return <p className="dt-msg">Loading...</p>;
  if (!rows || rows.length === 0) return <p className="dt-msg">No records yet.</p>;

  return (
    <div className="dt-wrapper">
      <table className="dt-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            {hasActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
              {hasActions && (
                <td className="dt-actions">
                  {extraActions && extraActions(row)}
                  {onEdit && (!showEdit || showEdit(row)) && (
                    <button className="dt-btn" onClick={() => onEdit(row)}>
                      Edit
                    </button>
                  )}
                  {onDelete && (!showDelete || showDelete(row)) && (
                    <button
                      className="dt-btn dt-btn-danger"
                      onClick={() => onDelete(row.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
