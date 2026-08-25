export default function PortalSegmentsPage() {
  return (
    <>
      <div className="crm-page-head">
        <div>
          <h2>Segments</h2>
          <p className="desc">Dynamic groups built from live filter rules.</p>
        </div>
        <div className="crm-actions">
          <button type="button" className="btn-dark" disabled>
            + Create segment
          </button>
        </div>
      </div>

      <div className="crm-empty">
        No segments yet. Segment functionality will be added next.
      </div>
    </>
  );
}
