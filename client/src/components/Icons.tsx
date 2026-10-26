import type { CSSProperties } from 'react';
import type { PieceCode } from '../../../shared/protocol';

export function FlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3v18" stroke="#2b2b2b" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7 3.5l11 4.5-11 4.5z" fill="#e53935" stroke="#9e1c1a" strokeWidth="1" strokeLinejoin="round" />
      <path d="M3.5 21h6" stroke="#2b2b2b" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function MineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#111" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3L5.3 18.7" />
      </g>
      <circle cx="12" cy="12" r="6.5" fill="#111" />
      <circle cx="9.7" cy="9.7" r="1.9" fill="#fff" />
    </svg>
  );
}

export function PieceImg(props: { code: PieceCode; className?: string; style?: CSSProperties }) {
  const { code, className, style } = props;
  return <img className={className} style={style} src={`/pieces/${code}.svg`} alt="" draggable={false} />;
}
