/* ==========================================================================
   StudyKit — Custom SVG Icon Library
   Premium minimalist line icons for Liquid Glass design language.
   All icons use 24x24 viewBox, 1.75px stroke, round caps, round joins.
   ========================================================================== */

import React from 'react';

type IconSize = 'sm' | 'md' | 'lg' | 'xl';
type IconProps = {
  size?: IconSize;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
};

/* ---- Base icon wrapper ---- */
function IconWrap({ children, size = 'md', className = '', style, onClick, title }: IconProps & { children: React.ReactNode }) {
  const sizeClass = size === 'sm' ? 'sk-icon-sm' : size === 'lg' ? 'sk-icon-lg' : size === 'xl' ? 'sk-icon-xl' : '';
  return (
    <span className={`sk-icon ${sizeClass} ${className}`} style={style} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} title={title}>
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        {children}
      </svg>
    </span>
  );
}

/* ---- Brand Logo ---- */
export function LogoIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      {/* Stylized 'S' mark — simple line art compatible with IconWrap */}
      <path d="M12 4a5 5 0 0 1 0 10H9" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M12 14a5 5 0 0 1 0 6H9" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <line x1="9" y1="12" x2="15" y2="12" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
    </IconWrap>
  );
}

/* ---- Sidebar Toggle (panel icon) ---- */
export function SidebarIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth="1.5" />
      <line x1="9" y1="3" x2="9" y2="21" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Modules (stacked cards/pages) ---- */
export function ModulesIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="5" y="4" width="14" height="16" rx="2" strokeWidth="1.5" />
      <line x1="8" y1="8" x2="16" y2="8" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="11" x2="14" y2="11" strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
      <line x1="8" y1="14" x2="12" y2="14" strokeWidth="1.25" strokeLinecap="round" opacity="0.4" />
    </IconWrap>
  );
}

/* ---- Literature (open book) ---- */
export function LiteratureIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeWidth="1.5" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeWidth="1.5" />
      <line x1="8" y1="7" x2="15" y2="7" strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
      <line x1="8" y1="10" x2="14" y2="10" strokeWidth="1.25" strokeLinecap="round" opacity="0.4" />
      {/* Atomic orbit accent for scientific literature */}
      <ellipse cx="17" cy="10" rx="2.5" ry="1.5" strokeWidth="1" opacity="0.3" transform="rotate(-30 17 10)" />
    </IconWrap>
  );
}

/* ---- Reading Lists (list with bullets/checks) ---- */
export function ReadingListIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
      <circle cx="7" cy="8" r="1" strokeWidth="1.5" fill="currentColor" />
      <line x1="11" y1="8" x2="18" y2="8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="12" r="1" strokeWidth="1.5" fill="currentColor" />
      <line x1="11" y1="12" x2="18" y2="12" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="16" r="1" strokeWidth="1.5" />
      <line x1="11" y1="16" x2="16" y2="16" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </IconWrap>
  );
}

/* ---- Graph (nodes + edges) ---- */
export function GraphIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="5" r="2.5" strokeWidth="1.5" />
      <circle cx="5" cy="17" r="2.5" strokeWidth="1.5" />
      <circle cx="19" cy="17" r="2.5" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.5" strokeWidth="1.25" opacity="0.5" />
      <line x1="12" y1="7.5" x2="7" y2="14.5" strokeWidth="1.25" />
      <line x1="12" y1="7.5" x2="17" y2="14.5" strokeWidth="1.25" />
      <line x1="7" y1="19.5" x2="17" y2="19.5" strokeWidth="1.25" />
    </IconWrap>
  );
}

/* ---- Rename / Edit (pencil) ---- */
export function RenameIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Copy (overlapping squares) ---- */
export function CopyIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" strokeWidth="1.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Delete / Trash ---- */
export function TrashIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M3 6h18" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" strokeWidth="1.5" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeWidth="1.5" />
      <line x1="10" y1="10" x2="10" y2="17" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="14" y1="10" x2="14" y2="17" strokeWidth="1.25" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Close / X ---- */
export function CloseIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="6" y1="6" x2="18" y2="18" strokeWidth="1.5" />
      <line x1="18" y1="6" x2="6" y2="18" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Add / Plus ---- */
export function AddIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="12" y1="5" x2="12" y2="19" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Chevron Up ---- */
export function ChevronUpIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="18 15 12 9 6 15" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Chevron Down ---- */
export function ChevronDownIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="6 9 12 15 18 9" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Restore (return arrow) ---- */
export function RestoreIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="1 4 1 10 7 10" strokeWidth="1.5" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Drag Handle (grip dots) ---- */
export function DragIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="10" cy="7" r="1" strokeWidth="1.25" fill="currentColor" />
      <circle cx="14" cy="7" r="1" strokeWidth="1.25" fill="currentColor" />
      <circle cx="10" cy="12" r="1" strokeWidth="1.25" fill="currentColor" />
      <circle cx="14" cy="12" r="1" strokeWidth="1.25" fill="currentColor" />
      <circle cx="10" cy="17" r="1" strokeWidth="1.25" fill="currentColor" />
      <circle cx="14" cy="17" r="1" strokeWidth="1.25" fill="currentColor" />
    </IconWrap>
  );
}

/* ---- Search ---- */
export function SearchIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="11" cy="11" r="7" strokeWidth="1.5" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Settings (gear) ---- */
export function SettingsIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Export (arrow out of box) ---- */
export function ExportIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="1.5" />
      <polyline points="7 10 12 15 17 10" strokeWidth="1.5" />
      <line x1="12" y1="15" x2="12" y2="3" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Sync / Refresh ---- */
export function SyncIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="23 4 23 10 17 10" strokeWidth="1.5" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Upload ---- */
export function UploadIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="1.5" />
      <polyline points="17 8 12 3 7 8" strokeWidth="1.5" />
      <line x1="12" y1="3" x2="12" y2="15" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Notes (document with lines) ---- */
export function NotesIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeWidth="1.5" />
      <polyline points="14 2 14 8 20 8" strokeWidth="1.5" />
      <line x1="8" y1="13" x2="16" y2="13" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="8" y1="17" x2="14" y2="17" strokeWidth="1.25" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Annotation / Tag / Highlight ---- */
export function AnnotationIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" strokeWidth="1.5" />
      <path d="M2 17l10 5 10-5" strokeWidth="1.5" />
      <path d="M2 12l10 5 10-5" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Star / Importance ---- */
export function StarIcon(props: IconProps) {
  const { style, ...rest } = props;
  return (
    <IconWrap {...rest} style={style}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Link / Chain ---- */
export function LinkIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeWidth="1.5" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Unlink ---- */
export function UnlinkIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="2" y1="2" x2="22" y2="22" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeWidth="1.5" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Cite / Quote ---- */
export function CiteIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="1.5" strokeWidth="1.25" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" strokeWidth="1.25" fill="currentColor" />
      <path d="M7 15c1 1.5 3 1.5 4 0" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M13 15c1 1.5 3 1.5 4 0" strokeWidth="1.25" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Back / Arrow Left ---- */
export function BackIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <line x1="19" y1="12" x2="5" y2="12" strokeWidth="1.5" />
      <polyline points="12 19 5 12 12 5" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Trash Can (full) ---- */
export function TrashFullIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M3 6h18" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" strokeWidth="1.5" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeWidth="1.5" />
      <line x1="10" y1="10" x2="10" y2="17" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="14" y1="10" x2="14" y2="17" strokeWidth="1.25" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Check / Success ---- */
export function CheckIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="20 6 9 17 4 12" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Pending / Clock ---- */
export function PendingIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      <polyline points="12 6 12 12 16 14" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Error / Alert ---- */
export function ErrorIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      <line x1="15" y1="9" x2="9" y2="15" strokeWidth="1.5" />
      <line x1="9" y1="9" x2="15" y2="15" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Offline / Cloud Off ---- */
export function OfflineIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" strokeWidth="1.5" />
      <line x1="1" y1="1" x2="23" y2="23" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Lecture / Presentation (stage/screen) ---- */
export function LectureIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="1.5" />
      <line x1="8" y1="21" x2="16" y2="21" strokeWidth="1.5" />
      <line x1="12" y1="17" x2="12" y2="21" strokeWidth="1.5" />
      <line x1="7" y1="8" x2="17" y2="8" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="8" cy="12" r="1.5" strokeWidth="1.25" fill="currentColor" />
    </IconWrap>
  );
}

/* ---- PDF / Document ---- */
export function PDFIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeWidth="1.5" />
      <polyline points="14 2 14 8 20 8" strokeWidth="1.5" />
      <text x="7.5" y="16" fontSize="8" fontWeight="600" fill="currentColor" stroke="none" fontFamily="system-ui">PDF</text>
    </IconWrap>
  );
}

/* ---- Upload with file icon ---- */
export function UploadFileIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="1.5" />
      <polyline points="17 8 12 3 7 8" strokeWidth="1.5" />
      <line x1="12" y1="3" x2="12" y2="15" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- Color dot (for module colors) ---- */
export function ColorDot({ color = '#6C63FF' }: { color?: string }) {
  return (
    <span className="sk-icon" style={{ width: '0.5em', height: '0.5em', minWidth: 8, minHeight: 8 }}>
      <svg viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
        <circle cx="4" cy="4" r="3.5" fill={color} />
      </svg>
    </span>
  );
}

/* ---- External link ---- */
export function ExternalLinkIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeWidth="1.5" />
      <polyline points="15 3 21 3 21 9" strokeWidth="1.5" />
      <line x1="10" y1="14" x2="21" y2="3" strokeWidth="1.5" />
    </IconWrap>
  );
}

/* ---- More options (three dots) ---- */
export function MoreIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconWrap>
  );
}

/* ---- Spark (AI, 4-pointed star + center dot) ---- */
export function SparkIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconWrap>
  );
}

/* ---- Flashcard (2 stacked cards, offset 2px) ---- */
export function FlashcardIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="3" y="5" width="14" height="16" rx="2" strokeWidth="1.5" />
      <rect x="6" y="3" width="14" height="16" rx="2" strokeWidth="1.5" fill="var(--surface, white)" />
      <line x1="9" y1="9" x2="17" y2="9" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="12" x2="15" y2="12" strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
    </IconWrap>
  );
}

/* ---- Code (< />) ---- */
export function CodeIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <polyline points="8 7 3 12 8 17" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="16 7 21 12 16 17" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="14" y1="5" x2="10" y2="19" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Mind Map (center node + 3 radiating branches) ---- */
export function MindMapIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <circle cx="12" cy="12" r="2.5" strokeWidth="1.5" />
      <circle cx="4" cy="4" r="1.5" strokeWidth="1.5" />
      <circle cx="20" cy="4" r="1.5" strokeWidth="1.5" />
      <circle cx="12" cy="20" r="1.5" strokeWidth="1.5" />
      <line x1="10" y1="10" x2="5.5" y2="5.5" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14" y1="10" x2="18.5" y2="5.5" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="14.5" x2="12" y2="18.5" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Highlight (pen tip over an underline) ---- */
export function HighlightIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M4 19h16" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 3l8 6-3.5 1-1 3.5-6-8z" strokeWidth="1.5" strokeLinejoin="round" />
    </IconWrap>
  );
}

/* ---- Pen (stylus at 30 deg) ---- */
export function PenIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M14 4l6 6L9 21H3v-6L14 4z" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="13" y1="5" x2="19" y2="11" strokeWidth="1.5" strokeLinecap="round" />
    </IconWrap>
  );
}

/* ---- Bookmark (V-shaped page marker) ---- */
export function BookmarkIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <path d="M6 3h12v18l-6-4-6 4V3z" strokeWidth="1.5" strokeLinejoin="round" />
    </IconWrap>
  );
}

/* ---- Cornell (3-column note layout: cue | main | summary) ---- */
export function CornellIcon(props: IconProps) {
  return (
    <IconWrap {...props}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" strokeWidth="1.5" />
      <line x1="8" y1="4" x2="8" y2="20" strokeWidth="1.5" />
      <line x1="16" y1="4" x2="16" y2="20" strokeWidth="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="1.25" opacity="0.55" />
    </IconWrap>
  );
}

/* ==========================================================================
   Combined icon component for dynamic rendering
   ========================================================================== */
const iconMap: Record<string, React.ComponentType<IconProps>> = {
  logo: LogoIcon,
  sidebar: SidebarIcon,
  modules: ModulesIcon,
  literature: LiteratureIcon,
  readingList: ReadingListIcon,
  graph: GraphIcon,
  rename: RenameIcon,
  copy: CopyIcon,
  trash: TrashIcon,
  close: CloseIcon,
  add: AddIcon,
  chevronUp: ChevronUpIcon,
  chevronDown: ChevronDownIcon,
  restore: RestoreIcon,
  drag: DragIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  export: ExportIcon,
  sync: SyncIcon,
  upload: UploadIcon,
  notes: NotesIcon,
  annotation: AnnotationIcon,
  star: StarIcon,
  link: LinkIcon,
  unlink: UnlinkIcon,
  cite: CiteIcon,
  back: BackIcon,
  check: CheckIcon,
  pending: PendingIcon,
  error: ErrorIcon,
  offline: OfflineIcon,
  lecture: LectureIcon,
  pdf: PDFIcon,
  externalLink: ExternalLinkIcon,
  more: MoreIcon,
  spark: SparkIcon,
  flashcard: FlashcardIcon,
  code: CodeIcon,
  mindMap: MindMapIcon,
  highlight: HighlightIcon,
  pen: PenIcon,
  bookmark: BookmarkIcon,
  cornell: CornellIcon,
};

export type IconName = keyof typeof iconMap;

export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Component = iconMap[name];
  if (!Component) return null;
  return <Component {...props} />;
}

export default Icon;
