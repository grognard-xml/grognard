import type { ItemProps } from '../item';

/**
 * 0 = the name is exactly the query, 1 = starts with it, 2 = contains it, 3 = only the long
 * description (`fullName`) contains it, null = no match. Typing "quote" must put `quote` ahead of
 * `q`, whose description merely mentions it.
 */
const matchRank = ({ name, fullName }: ItemProps, query: string): number | null => {
  const lowerName = name.toLowerCase();
  if (lowerName === query) return 0;
  if (lowerName.startsWith(query)) return 1;
  if (lowerName.includes(query)) return 2;
  if (fullName?.toLowerCase().includes(query)) return 3;
  return null;
};

/**
 * The list filtered by `query` and ordered best match first (ties keep their original order). An
 * empty query returns the list untouched, dividers included; with a query dividers are dropped
 * because grouping no longer means anything in a ranked list.
 */
export const rankMenuItems = (list: ItemProps[], query: string): ItemProps[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;

  return list
    .map((item, index) => ({
      item,
      index,
      rank: item.type === 'divider' ? null : matchRank(item, needle),
    }))
    .filter(
      (entry): entry is { item: ItemProps; index: number; rank: number } => entry.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
};
