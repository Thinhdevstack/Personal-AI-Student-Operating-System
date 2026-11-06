import { headers } from 'next/headers';

// The custom server overwrites this header on every page request; one build serves either mode.
export async function getStudentDemo() {
  return process.env.OFFICE_STATIC !== '1' && (await headers()).get('x-office-student-demo') === '1';
}

export async function getStudentLocal() {
  return process.env.OFFICE_STATIC !== '1' && (await headers()).get('x-office-student-local') === '1';
}
