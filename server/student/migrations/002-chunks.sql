CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  courseId TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  pageNumber INTEGER NOT NULL CHECK(pageNumber >= 1),
  chunkIndex INTEGER NOT NULL CHECK(chunkIndex >= 0),
  content TEXT NOT NULL,
  tokenCount INTEGER NOT NULL CHECK(tokenCount > 0),
  createdAt TEXT NOT NULL,
  UNIQUE(documentId, pageNumber, chunkIndex)
);

CREATE TABLE chunk_embeddings (
  chunkId TEXT PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK(dimensions > 0),
  modelVersion TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX chunks_document ON document_chunks(documentId);
CREATE INDEX chunks_course ON document_chunks(courseId);
CREATE INDEX embeddings_model ON chunk_embeddings(model, dimensions);

ALTER TABLE documents ADD COLUMN processingError TEXT;
ALTER TABLE documents ADD COLUMN processedAt TEXT;
