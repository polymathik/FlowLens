/** The transport icons (14 px, currentColor). */
import React from 'react';

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" aria-hidden focusable="false">
    {children}
  </svg>
);

export const PlayIcon = () => (
  <Svg>
    <path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.1-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5z" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
  </Svg>
);
export const StepBackIcon = () => (
  <Svg>
    <rect x="3" y="3" width="2" height="10" rx="0.8" />
    <path d="M13 3.2v9.6a.5.5 0 0 1-.78.42L6 8.4a.5.5 0 0 1 0-.8l6.22-4.82A.5.5 0 0 1 13 3.2z" />
  </Svg>
);
export const StepForwardIcon = () => (
  <Svg>
    <rect x="11" y="3" width="2" height="10" rx="0.8" />
    <path d="M3 3.2v9.6a.5.5 0 0 0 .78.42L10 8.4a.5.5 0 0 0 0-.8L3.78 2.78A.5.5 0 0 0 3 3.2z" />
  </Svg>
);
export const FirstIcon = () => (
  <Svg>
    <rect x="2.5" y="3" width="2" height="10" rx="0.8" />
    <path d="M13.5 3.2v9.6a.5.5 0 0 1-.78.42L6.5 8.4a.5.5 0 0 1 0-.8l6.22-4.82a.5.5 0 0 1 .78.42z" />
  </Svg>
);
export const LastIcon = () => (
  <Svg>
    <rect x="11.5" y="3" width="2" height="10" rx="0.8" />
    <path d="M2.5 3.2v9.6a.5.5 0 0 0 .78.42L9.5 8.4a.5.5 0 0 0 0-.8L3.28 2.78a.5.5 0 0 0-.78.42z" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg>
    <path d="M3.7 2.3 8 6.6l4.3-4.3 1.4 1.4L9.4 8l4.3 4.3-1.4 1.4L8 9.4l-4.3 4.3-1.4-1.4L6.6 8 2.3 3.7z" />
  </Svg>
);
