import { z } from "zod";

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const calendarDate = z.string().refine(isCalendarDate, "Enter a valid calendar date.");
export function displayDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !isCalendarDate(value)) return "Unknown date";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date)
    : "Unknown date";
}
