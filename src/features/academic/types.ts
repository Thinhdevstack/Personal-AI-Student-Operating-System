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
