export type Status = 'active' | 'archived';
export interface Semester {
  id: string; name: string; academicYear: string; startDate: string | null; endDate: string | null;
  status: Status; isActive: number; createdAt: string; updatedAt: string;
}
export interface Course {
  id: string; semesterId: string; name: string; code: string; description: string;
  status: Status; createdAt: string; updatedAt: string;
}
export interface Material {
  id: string; courseId: string; filename: string; originalFilename: string; mimeType: string;
  pageCount: number | null; sizeBytes: number; status: 'uploaded' | 'processing' | 'ready' | 'failed'; uploadedAt: string;
}
export interface AcademicSnapshot { semesters: Semester[]; courses: Course[]; recentMaterials: Material[] }
