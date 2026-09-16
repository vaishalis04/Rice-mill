export default function PdfPreviewModal({ title, blobUrl, fileName, onClose }) {
  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: 8,
          width: "100%",
          maxWidth: 960,
          height: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="dt-btn" onClick={handleDownload}>
              Download
            </button>
            <button type="button" className="sf-cancel" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <iframe src={blobUrl} title={title} style={{ flex: 1, border: "none", width: "100%" }} />
      </div>
    </div>
  );
}