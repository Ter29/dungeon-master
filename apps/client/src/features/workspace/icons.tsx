const paths: Record<string, string> = {
  table: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
  scenes: "M3 5h18v14H3z M3 15l5-5 5 6 3-3 5 5 M16 8h.01",
  maps: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16",
  director: "M4 4h12v16H4z M16 9l5-3v12l-5-3 M8 9l5 3-5 3z",
  audio:
    "M9 18V5l12-2v13 M9 8l12-2 M9 18c0 2-6 3-6 0s6-3 6 0 M21 16c0 2-6 3-6 0s6-3 6 0",
  combat:
    "M4 3l3 1 11 12-2 2L4 6z M16 16l5 5 M15 20l5-5 M20 3l-3 1-4 5 M4 21l5-5 M3 16l5 5",
  campaign: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M9 11l2 2 4-4",
  users:
    "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M17 4a4 4 0 0 1 0 8 M18 15a5 5 0 0 1 4 5",
  panel: "M3 4h18v16H3z M15 4v16 M18 8v8",
  exit: "M9 4H3v16h6 M13 7l5 5-5 5 M7 12h14",
  brand:
    "M12 2l9 6v9l-9 5-9-5V8z M12 2L8 14l4 8 4-8z M3 8l5 6h8l5-6 M8 14L3 17 M16 14l5 3",
  arrow: "M4 12h16 M14 6l6 6-6 6",
  spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.spark} />
    </svg>
  );
}
