import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

export function Svg({ size = 16, children, className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'icon'}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: Props) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconSearch = (p: Props) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
);
export const IconMenu = (p: Props) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const IconSun = (p: Props) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /></Svg>
);
export const IconMoon = (p: Props) => (
  <Svg {...p}><path d="M16 13a6 6 0 1 1-5-9 7 7 0 0 0 8 10 6 6 0 0 1-3-1z" /></Svg>
);
export const IconPanel = (p: Props) => (
  <Svg {...p}><path d="M8 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8" /><path d="M8 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" /><path d="M8 4v16" /></Svg>
);
export const IconClose = (p: Props) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const IconSend = (p: Props) => (
  <Svg {...p}><path d="m6 12 6-7 6 7M12 5v14" /></Svg>
);
export const IconStop = (p: Props) => (
  <Svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></Svg>
);
export const IconCopy = (p: Props) => (
  <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
);
export const IconCheck = (p: Props) => (
  <Svg {...p}><path d="M5 12.5 9.5 17 19 7.5" /></Svg>
);
export const IconRefresh = (p: Props) => (
  <Svg {...p}><path d="M20 12a8 8 0 1 1-2.2-5.5" /><path d="M20 5v5h-5" /></Svg>
);
export const IconThumbUp = (p: Props) => (
  <Svg {...p}><path d="M7 11v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h2zm0 0 4.2-7.2A1.8 1.8 0 0 1 14.5 5v6H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 21H7" /></Svg>
);
export const IconThumbDown = (p: Props) => (
  <Svg {...p}><path d="M17 13V4h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2zm0 0-4.2 7.2A1.8 1.8 0 0 1 9.5 19v-6H5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.2 3H17" /></Svg>
);
export const IconTrash = (p: Props) => (
  <Svg {...p}><path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" /></Svg>
);
export const IconFile = (p: Props) => (
  <Svg {...p}><path d="M7 3.5h6l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" /><path d="M13 3.5V9h5.5" /></Svg>
);
export const IconInfo = (p: Props) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>
);
export const IconLogo = (p: Props) => (
  <Svg {...p}><path d="M7 4.5h8.5a2 2 0 0 1 2 2V19a.9.9 0 0 1-1.5.7L13 17H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z" /><path d="M9 8.5h6M9 12h4" /></Svg>
);
