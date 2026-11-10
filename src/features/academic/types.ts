export type Status = 'active' | 'archived';

export interface Semester {
  id: string;
  name: string;
  academicYear: string;
  startDate: string | null;
  endDate: string | null;
  status: Status;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  hasData: number;
  id: string;
  semesterId: string;
  name: string;
  code: string;
  description: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
}

export interface Material {
  processingPhase?: 'queued' | 'extracting' | 'ocr' | 'indexing';
  processingPage?: number;
  processingPages?: number;
  completedChunks?: number;
  totalChunks?: number;
  indexReady?: boolean;
  id: string;
  courseId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  pageCount: number | null;
  sizeBytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  uploadedAt: string;
  processingError?: string | null;
  processedAt?: string | null;
  chunkCount?: number;
  embeddedChunks?: number;
  coverageStatus?: 'full' | 'partial' | 'ocr_fallback' | 'empty' | 'unknown';
  extractorVersion?: string;
  pagesWithText?: number;
  pagesOcr?: number;
  pagesWarning?: number;
}

export interface DocumentPage {
  documentId: string;
  pageNumber: number;
  method: 'native' | 'ocr' | 'combined' | 'none';
  status: 'extracted' | 'ocr_applied' | 'ocr_failed' | 'empty';
  charCount: number;
  warningCode?: string | null;
  ocrLanguage?: string | null;
  ocrEngine?: string | null;
  extractedAt: string;
}

export interface SearchResult {
  documentId: string;
  documentName: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface AcademicSnapshot {
  semesters: Semester[];
  courses: Course[];
  recentMaterials: Material[];
}
