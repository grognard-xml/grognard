import { Box, ButtonBase, Tooltip } from '@mui/material';
import type Writer from '../../js/Writer';
import { insertAtCursor, insertBracketPair, type ChhivSymbol } from '../../utilities/chhivSymbols';

/**
 * A compact grid of the palaeography symbols, replacing what used to be one
 * long menu row of text per symbol (illegible to scan, and the majority of
 * the screen space went to the description rather than the symbol itself).
 * Each cell shows just the glyph large; the description that used to sit
 * inline is now a hover tooltip. Clicking inserts immediately and leaves
 * the dialog open, so several symbols can be inserted in a row.
 */
export const ChhivSymbolGridDialog = ({
  symbols,
  writer,
}: {
  symbols: ChhivSymbol[];
  writer: Writer;
}) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 1,
        maxWidth: 380,
      }}
    >
      {symbols.map((symbol) => (
        <Tooltip key={symbol.id} title={symbol.description}>
          <ButtonBase
            onClick={() => {
              if ('open' in symbol) insertBracketPair(writer, symbol.open, symbol.close);
              else insertAtCursor(writer, symbol.insert);
            }}
            sx={{
              height: 44,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              fontSize: symbol.symbol.length > 1 ? '1.1em' : '1.4em',
              whiteSpace: 'nowrap',
            }}
          >
            {symbol.symbol}
          </ButtonBase>
        </Tooltip>
      ))}
    </Box>
  );
};

export default ChhivSymbolGridDialog;
