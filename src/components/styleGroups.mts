/** Shared grouping for the lists that offer figures and dances by dance
 *  style (the figure library and the Open menu's presets). Groups are
 *  sorted by style and the items in each by name, both alphabetically
 *  as a reader expects: ignoring case and accents ("Promenade Chassé"
 *  sorts with "Promenade Chasse"), so "Reverse Box Turn" comes before
 *  "RF Closed Change". */
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

export function groupByStyle<T extends { name: string; style: string }>(
  items: readonly T[],
): [style: string, items: T[]][] {
  const byStyle = new Map<string, T[]>();
  for (const item of items) {
    const group = byStyle.get(item.style);
    if (group) {
      group.push(item);
    } else {
      byStyle.set(item.style, [item]);
    }
  }
  return [...byStyle.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([style, group]) => [
      style,
      group.sort((a, b) => compareNames(a.name, b.name)),
    ]);
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
