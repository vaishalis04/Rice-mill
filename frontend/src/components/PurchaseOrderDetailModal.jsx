import { useState, useEffect } from "react";
import { getPurchaseOrderByPoNoApi, getPurchaseOrderPdfApi } from "../api/api";
import DataTable from "./DataTable";

/**
 * <PurchaseOrderDetailModal poNo="PO-20260814-001" onClose={() => ...} />
 * Fetches GET /purchases/po/:po_no and shows the shared header (vendor,
 * date, validity, DO no.) plus every line item under that PO number, with
 * a Download PDF button that streams the same data as a PDF.
 */
export default function PurchaseOrderDetailModal({ poNo, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    getPurchaseOrderByPoNoApi(poNo)
      .then((res) => setData(res.data.data ?? res.data))
      .catch((err) =>
        setError(err.response?.data?.message || "Failed to load this purchase order")
      )
      .finally(() => setLoading(false));
  }, [poNo]);

  const handleDownloadPdf = async () => {
    setError("");
    setDownloading(true);
    try {
      const res = await getPurchaseOrderPdfApi(poNo);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${poNo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't download the PO PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        zIndex: 1000,
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: 24,
          maxWidth: 900,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Purchase Order — {poNo}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sf-submit" onClick={handleDownloadPdf} disabled={downloading || !data}>
              {downloading ? "Downloading…" : "Download PDF"}
            </button>
            <button className="dt-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {loading && <p className="dt-msg">Loading...</p>}
        {error && <div className="dt-error">{error}</div>}

        {data && (
          <>
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f7f8fa",
                borderRadius: 8,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Vendor</div>
                <div style={{ fontWeight: 600 }}>
                  {data.vendor ? `${data.vendor.name} (${data.vendor.vendor_code})` : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>PO Date</div>
                <div>{data.po_date ? new Date(data.po_date).toLocaleDateString() : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Validity</div>
                <div>{data.validity ? new Date(data.validity).toLocaleDateString() : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>DO No.</div>
                <div>{data.do_no || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Line Items</div>
                <div>{data.items.length}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#666" }}>Total Amount</div>
                <div style={{ fontWeight: 600 }}>{Number(data.total_amount).toFixed(2)}</div>
              </div>
            </div>

            <h3 style={{ marginTop: 24 }}>Materials</h3>
            <DataTable
              rows={data.items}
              columns={[
                {
                  key: "material_id",
                  label: "Material",
                  render: (row) => row.material?.name || "—",
                },
                {
                  key: "variety_id",
                  label: "Variety",
                  render: (row) => row.variety?.variety_name || "—",
                },
                { key: "qty", label: "Qty (Tons)" },
                { key: "rate", label: "Rate" },
                {
                  key: "amount",
                  label: "Amount",
                  render: (row) => (Number(row.qty) * Number(row.rate)).toFixed(2),
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}