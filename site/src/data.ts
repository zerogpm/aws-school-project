export const NAV = [
  { to: "/", label: "Home" },
  { to: "/timetable", label: "Timetable" },
  { to: "/interviews", label: "Interviews" },
  { to: "/documents", label: "Documents" },
];

export const FACTS = [
  { value: "800", label: "Students" },
  { value: "60", label: "Teaching staff" },
  { value: "1962", label: "Established" },
  { value: "24", label: "Clubs & teams" },
];

export const TIMETABLE = [
  { period: "1", time: "8:45 - 10:00", dayA: "English 11", dayB: "Biology 11" },
  { period: "2", time: "10:10 - 11:25", dayA: "Mathematics 11", dayB: "History 11" },
  { period: "-", time: "11:25 - 12:10", dayA: "Lunch", dayB: "Lunch", isBreak: true },
  { period: "3", time: "12:10 - 1:25", dayA: "Chemistry 11", dayB: "Francais 11" },
  { period: "4", time: "1:35 - 2:50", dayA: "Physical Education", dayB: "Visual Arts 11" },
];

// The slot fixtures that used to live here are gone. From episode 04 the times
// come from GET /windows/{id}/slots against the real table, and availability is
// computed from the item rather than being a hardcoded `full: true`.
// See src/api/interviews.ts.

/**
 * A student number is S followed by five digits. This is the only gate on the
 * public booking route - no parent accounts exist. The identical check runs
 * server-side in episode 04, because a client-side check stops typos, not
 * attackers.
 */
export const STUDENT_NUMBER = /^S\d{5}$/;

export function isValidStudentNumber(value: string): boolean {
  return STUDENT_NUMBER.test(value.trim().toUpperCase());
}

export type Announcement = {
  id: string;
  date: string;
  title: string;
  body: string;
};

/**
 * Static for now. In a later episode staff publish these through the API and
 * they become a query against the single table, but the shape does not change.
 */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "a-timetables",
    date: "18 August 2026",
    title: "Semester 1 timetables are published",
    body: "Grade 11 and 12 timetables are on the timetable page. Course changes must go through the counselling office before 12 September.",
  },
  {
    id: "a-interviews",
    date: "14 August 2026",
    title: "Interview booking opens 1 October",
    body: "Parent-teacher interviews run the evenings of 14 and 15 October. Booking needs your child's student number - no account required.",
  },
  {
    id: "a-orientation",
    date: "11 August 2026",
    title: "Grade 9 orientation, 8 September",
    body: "New students and their families are welcome from 6:00 pm in the main gym. Tours run until 7:30 pm.",
  },
  {
    id: "a-buses",
    date: "6 August 2026",
    title: "Bus route changes for September",
    body: "Routes 3 and 7 have new morning pickup times. Check the revised schedule before the first day.",
  },
  {
    id: "a-sports",
    date: "29 July 2026",
    title: "Fall sports tryouts",
    body: "Soccer, cross-country and volleyball tryouts begin the week of 8 September. Sign-up sheets are outside the PE office.",
  },
];

export type SchoolEvent = {
  id: string;
  date: string;
  day: string;
  title: string;
  detail?: string;
};

export const EVENTS: SchoolEvent[] = [
  { id: "e-first-day", date: "2 Sep", day: "Wed", title: "First day of classes" },
  {
    id: "e-orientation",
    date: "8 Sep",
    day: "Tue",
    title: "Grade 9 orientation",
    detail: "6:00 pm, main gym",
  },
  {
    id: "e-interviews",
    date: "14 Oct",
    day: "Wed",
    title: "Parent-teacher interviews",
    detail: "5:00 - 8:00 pm",
  },
  {
    id: "e-pro-d",
    date: "23 Oct",
    day: "Fri",
    title: "Professional development day",
    detail: "No classes",
  },
];

export type BellPeriod = {
  label: string;
  regular: string;
  lateStart: string;
};

/**
 * Distinct from the course timetable: this is when the bells ring, and it is
 * the thing students actually look up. Late-start days run on assembly and
 * professional development mornings.
 */
export const BELL_SCHEDULE: BellPeriod[] = [
  { label: "Warning bell", regular: "8:40", lateStart: "9:40" },
  { label: "Period 1", regular: "8:45 - 10:00", lateStart: "9:45 - 10:40" },
  { label: "Period 2", regular: "10:10 - 11:25", lateStart: "10:50 - 11:45" },
  { label: "Lunch", regular: "11:25 - 12:10", lateStart: "11:45 - 12:25" },
  { label: "Period 3", regular: "12:10 - 1:25", lateStart: "12:25 - 1:20" },
  { label: "Period 4", regular: "1:35 - 2:50", lateStart: "1:30 - 2:25" },
  { label: "Dismissal", regular: "2:50", lateStart: "2:25" },
];
