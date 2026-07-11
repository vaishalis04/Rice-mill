import "./DataTable.css";

/**
 * Generic list table.
 * columns: [{ key: "name", label: "Name" }, ...]
 * rows: array of objects
 * onEdit / onDelete: optional (id, row) => void handlers; omit to hide the column
 */
export default function DataTable({ columns, rows, onEdit, onDelete, loading }) {
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
            {(onEdit || onDelete) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
              {(onEdit || onDelete) && (
                <td className="dt-actions">
                  {onEdit && (
                    <button className="dt-btn" onClick={() => onEdit(row)}>
                      Edit
                    </button>
                  )}
                  {onDelete && (
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
