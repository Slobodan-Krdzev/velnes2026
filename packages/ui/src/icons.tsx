/** The prototype's icon library, verbatim (const I / icon()). */

export const I = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  register:
    '<rect x="2" y="9" width="20" height="12" rx="2"/><path d="M6 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M6 13h4M14 13h4M6 17h12"/>',
  products:
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  reports: '<path d="M3 3v18h18"/><path d="M7 15v-4M12 15V7M17 15v-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  tag: '<path d="M20.6 13.4 12 4.8H4v8l8.6 8.6a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8"/><path d="M7.5 7.5h.01"/>',
  note: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  invoice: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  arrowleft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  clipboard:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8A.8.8 0 0 1 9.8 2h4.4a.8.8 0 0 1 .8.8V4"/><path d="M8.5 11h7M8.5 15h5"/>',
  hands:
    '<path d="M9 13V5.5a1.5 1.5 0 0 1 3 0V12M12 12V4.5a1.5 1.5 0 0 1 3 0V12M15 12V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0"/>',
  dumbbell:
    '<path d="M5 9v6M2.5 10.5v3M19 9v6M21.5 10.5v3"/><path d="M5 12h14"/><path d="M8 7v10M16 7v10"/>',
  home: '<path d="m3 10.5 9-7.5 9 7.5"/><path d="M5.5 9v11.5h13V9"/><path d="M9.5 20.5v-6h5v6"/>',
  pulse: '<path d="M2 12h4l2.5-7 4 14L15 12h7"/>',
  bottle:
    '<path d="M10 2h4v3.5l2.4 3.1A4 4 0 0 1 17 11v8a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3v-8a4 4 0 0 1 .6-2.4L10 5.5z"/><path d="M7 14h10"/>',
  package: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  giftcard:
    '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 12h20M12 6v14"/><path d="M12 6c-1.5-2.5-5-2.5-5 0 0 1.1.9 2 2 2h3zM12 6c1.5-2.5 5-2.5 5 0 0 1.1-.9 2-2 2h-3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chain:
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>',
  filter:
    '<path d="M3 6h2.4M10.6 6h10.4M3 12h10.4M18.6 12h2.4M3 18h4.9M13.1 18h7.9"/>' +
    '<circle cx="8" cy="6" r="2.6"/><circle cx="16" cy="12" r="2.6"/><circle cx="10.5" cy="18" r="2.6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
} as const;

export function Icon({ d, size = 24, w = 2 }: { d: string; size?: number; w?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/** The Velnes flower mark from the prototype's sidebar. */
export function VelnesMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * (33 / 34))}
      viewBox="0 0 30 29"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M29.7675 10.7637C28.8761 8.0534 25.9691 6.58211 23.2947 7.47263C20.0389 8.51802 18.7598 13.3965 15.7753 14.4806C15.8528 11.3057 20.1164 8.55674 20.1164 5.14953C20.1164 2.28438 17.8296 0 15.0001 0C12.1706 0 9.88382 2.28438 9.88382 5.11081C9.88382 8.55674 14.1861 11.267 14.2249 14.4419C11.2404 13.3965 9.96134 8.51802 6.70552 7.47263C4.03111 6.58211 1.12413 8.0534 0.271416 10.7637C-0.620057 13.4352 0.852811 16.3391 3.56599 17.2296C6.78304 18.275 10.659 15.1389 13.721 15.9519C11.7443 18.4299 6.78304 18.1589 4.8063 20.9466C3.13963 23.231 3.68227 26.4446 5.96909 28.1095C8.25591 29.7744 11.473 29.2323 13.1396 26.9479C15.1551 24.1602 13.2559 19.4753 15.0389 16.8425C16.8218 19.4753 14.9613 24.1602 16.9381 26.9479C18.6047 29.2323 21.783 29.7744 24.1086 28.1095C26.3954 26.4446 26.9381 23.2697 25.2714 20.9466C23.2947 18.1976 18.2947 18.4299 16.3567 15.9519C19.4187 15.1389 23.2559 18.275 26.5117 17.2296C29.1474 16.3391 30.6203 13.4352 29.7675 10.7637Z" />
    </svg>
  );
}

/** The prototype's calendar colour palette per employee. */
export const EMP_COLORS: [string, string, string, string][] = [
  ['olive', 'Olive', '#eceee2', '#6f7357'],
  ['clay', 'Clay', '#f2e5cf', '#9a7434'],
  ['rose', 'Rose', '#f3dfe6', '#a2637b'],
  ['sage', 'Sage', '#dcebe1', '#4f8264'],
  ['lilac', 'Lilac', '#e2e3f2', '#6b70a3'],
  ['sky', 'Sky', '#dbe8f3', '#4f7391'],
  ['sand', 'Sand', '#f0e7d8', '#8a7343'],
  ['stone', 'Stone', '#e6e6e4', '#6e6e6a'],
];
export const empColorOf = (key: string | null | undefined) =>
  EMP_COLORS.find((c) => c[0] === key) ?? EMP_COLORS[EMP_COLORS.length - 1]!;
