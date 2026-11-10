-- B4: Store per-page extraction provenance, coverage status, and selective OCR records.
CREATE TABLE IF NOT EXISTS document_pages (
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  pageNumber INTEGER NOT NULL CHECK(pageNumber >= 1),
  method TEXT NOT NULL CHECK(method IN ('native', 'ocr', 'combined', 'none')),
  status TEXT NOT NULL CHECK(status IN ('extracted', 'ocr_applied', 'ocr_failed', 'empty')),
  charCount INTEGER NOT NULL CHECK(charCount >= 0),
  warningCode TEXT,
  ocrLanguage TEXT,
  ocrEngine TEXT,
  extractedAt TEXT NOT NULL,
  PRIMARY KEY(documentId, pageNumber)
);

CREATE INDEX IF NOT EXISTS document_pages_doc ON document_pages(documentId);

ALTER TABLE documents ADD COLUMN extractorVersion TEXT DEFAULT '';
ALTER TABLE documents ADD COLUMN coverageStatus TEXT DEFAULT 'unknown';
ALTER TABLE documents ADD COLUMN pagesWithText INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN pagesOcr INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN pagesWarning INTEGER DEFAULT 0;

