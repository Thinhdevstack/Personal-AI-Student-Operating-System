export type StudentOperation = 'turn' | 'library.search' | 'memory.search' | 'ai.respond';
export type StudentActivityStatus = 'started' | 'completed' | 'failed' | 'interrupted';
export interface StudentActivityEvent {
  version: 1; epoch: string; seq: number; eventId: string;
  courseId: string; courseName: string; requestId: string; turnId: string; attemptId: string;
  operation: StudentOperation; status: StudentActivityStatus; timestamp: number; isMock: boolean; count?: number;
}
export interface StudentActivityRow { event: StudentActivityEvent; steps: { operation: Exclude<StudentOperation, 'turn'>; status: StudentActivityStatus; count?: number }[] }
export interface StudentActivitySnapshot { version: 1; epoch: string; seq: number; generatedAt: number; courses: StudentActivityRow[] }
export interface StudentActivityState { epoch: string | null; seq: number; courses: Map<string, StudentActivityRow> }
export const STUDENT_OPERATIONS: readonly StudentOperation[];
export const STUDENT_STATUSES: readonly StudentActivityStatus[];
export const STUDENT_ACTIVITY_LIMITS: Readonly<{ courses: number; actors: number; activeMs: number; keepMs: number; clientMs: number; animationMs: number; travelMs: number }>;
export function validStudentEvent(value: unknown): value is StudentActivityEvent;
export function validStudentSnapshot(value: unknown): value is StudentActivitySnapshot;
export function createStudentActivityState(): StudentActivityState;
export function applyStudentSnapshot(state: StudentActivityState, snapshot: unknown): boolean;
export function applyStudentEvent(state: StudentActivityState, event: unknown): boolean;
