import type { IdsOperator } from '../../utilities/kageCompose';

/**
 * A tiny picture of an IDS layout, for the palette. These are diagrams of
 * the boxes, not the character that will be drawn. Strokes use currentColor
 * so the button's text color paints them.
 */
const frame = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 };

export const LayoutGlyph = ({ operator }: { operator: IdsOperator }) => (
  <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
    {diagram(operator)}
  </svg>
);

const diagram = (operator: IdsOperator) => {
  switch (operator) {
    case '⿰':
      return (
        <>
          <rect {...frame} x="1" y="1" width="6" height="14" />
          <rect {...frame} x="9" y="1" width="6" height="14" />
        </>
      );
    case '⿱':
      return (
        <>
          <rect {...frame} x="1" y="1" width="14" height="6" />
          <rect {...frame} x="1" y="9" width="14" height="6" />
        </>
      );
    case '⿲':
      return (
        <>
          <rect {...frame} x="1" y="1" width="3.5" height="14" />
          <rect {...frame} x="6.25" y="1" width="3.5" height="14" />
          <rect {...frame} x="11.5" y="1" width="3.5" height="14" />
        </>
      );
    case '⿳':
      return (
        <>
          <rect {...frame} x="1" y="1" width="14" height="3.5" />
          <rect {...frame} x="1" y="6.25" width="14" height="3.5" />
          <rect {...frame} x="1" y="11.5" width="14" height="3.5" />
        </>
      );
    case '⿴':
      return (
        <>
          <rect {...frame} x="1" y="1" width="14" height="14" />
          <rect {...frame} x="5" y="5" width="6" height="6" />
        </>
      );
    case '⿵':
      return (
        <>
          <path {...frame} d="M1 1 h14 v8 h-4 v6 h-6 v-6 h-4 z" />
          <rect {...frame} x="5" y="8" width="6" height="6" />
        </>
      );
    case '⿶':
      return (
        <>
          <path {...frame} d="M1 15 h14 v-8 h-4 v-6 h-6 v6 h-4 z" />
          <rect {...frame} x="5" y="2" width="6" height="6" />
        </>
      );
    case '⿷':
      return (
        <>
          <path {...frame} d="M1 1 h8 v4 h6 v6 h-6 v4 h-8 z" />
          <rect {...frame} x="8" y="5" width="6" height="6" />
        </>
      );
    case '⿸':
      return (
        <>
          <path {...frame} d="M1 1 h14 v6 h-8 v8 h-6 z" />
          <rect {...frame} x="8" y="8" width="6" height="6" />
        </>
      );
    case '⿹':
      return (
        <>
          <path {...frame} d="M15 1 h-14 v6 h8 v8 h6 z" />
          <rect {...frame} x="2" y="8" width="6" height="6" />
        </>
      );
    case '⿺':
      return (
        <>
          <path {...frame} d="M1 15 h14 v-6 h-8 v-8 h-6 z" />
          <rect {...frame} x="8" y="2" width="6" height="6" />
        </>
      );
    case '⿻':
      return (
        <>
          <rect {...frame} x="1" y="3" width="10" height="10" />
          <rect {...frame} x="5" y="1" width="10" height="10" />
        </>
      );
    default:
      return <rect {...frame} x="1" y="1" width="14" height="14" />;
  }
};
