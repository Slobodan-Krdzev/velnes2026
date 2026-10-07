-- migrate:up

-- Supplier media: printed catalogs as PDFs (Alex, 2026-10-07).
--
-- A supplier attaches the PDF catalogs it had made for print and
-- publishes them; a connected salon opens them from the supplier's row
-- in Workspace › Suppliers. The bytes live here, content-addressed by
-- sha256, PDF only, 15 MB each — no object store to run on the VPS and
-- nothing to fake. The supplier adds and removes at any time; a salon
-- sees a supplier's files only while connected; HQ reads.
CREATE TABLE supplier_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  mime              text NOT NULL DEFAULT 'application/pdf' CHECK (mime = 'application/pdf'),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sha256            text NOT NULL,
  data              bytea NOT NULL,
  uploaded_by       uuid REFERENCES supplier_users(id) ON DELETE SET NULL,
  uploaded_by_name  text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_media_supplier ON supplier_media (supplier_id, created_at DESC);
ALTER TABLE supplier_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_media FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_own ON supplier_media
  USING (supplier_id::text = current_setting('app.supplier_id', true))
  WITH CHECK (supplier_id::text = current_setting('app.supplier_id', true));
-- A salon reads a supplier's catalogs only while connected to it.
CREATE POLICY tenant_connected_read ON supplier_media FOR SELECT
  USING (current_setting('app.tenant_id', true) IS NOT NULL
         AND EXISTS (SELECT 1 FROM supplier_connections c
                     WHERE c.supplier_id = supplier_media.supplier_id
                       AND c.tenant_id = app.current_tenant()
                       AND c.status = 'connected'));
CREATE POLICY hq_read ON supplier_media FOR SELECT
  USING (current_setting('app.hq', true) = '1');

-- migrate:down
DROP TABLE supplier_media;
