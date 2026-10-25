// Authored icons; sized in em so they follow the text they sit in.

/** Filled = warning, outlined = caution. */
export const Tri = ({ outline = false }: { outline?: boolean }) => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
    <path d="M8 1.75 14.75 14H1.25z" fill={outline ? "none" : "currentColor"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

/** Points up at rotate 0. */
export const Arrow = ({ rotate = 0, title }: { rotate?: number; title?: string }) => (
  <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
    {title && <title>{title}</title>}
    <g transform={`rotate(${rotate} 12 12)`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21V4M5.5 10.5 12 4l6.5 6.5" />
    </g>
  </svg>
);

export const Chevron = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
    <path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Dot = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 12 12" width="0.75em" height="0.75em" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
  </svg>
);
