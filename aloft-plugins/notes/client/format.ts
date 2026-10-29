const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/** "14:32" today, "Yesterday", a weekday within a week, then "12 Oct", then "12 Oct 2025". */
export function formatEdited(mtimeMs: number, now = new Date()): string {
  const date = new Date(mtimeMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (mtimeMs >= startOfToday) return `${two(date.getHours())}:${two(date.getMinutes())}`;
  const days = Math.ceil((startOfToday - mtimeMs) / 86_400_000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return DAYS[date.getDay()];
  const dayMonth = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`;
}

/** "Thursday, 29 October" for daily notes named YYYY-MM-DD; other titles pass through. */
export function displayTitle(title: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(title);
  if (!match) return title;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  return `${weekday}, ${date.getDate()} ${date.toLocaleDateString("en-GB", { month: "long" })}`;
}

export function wordCount(text: string): number {
  const words = text
    .replace(/^---[\s\S]*?\n---\s*/, "")
    .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}
