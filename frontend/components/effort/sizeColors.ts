import type { TshirtSize } from '@/shared/types';

/**
 * Color palette for T-shirt sizes. Cool (small) → warm (large); "None" is
 * gray so unsized work is visually distinct from sized work.
 */
export const SIZE_COLORS: Record<TshirtSize, string> = {
  XS: '#2e7d32', // deep green
  S: '#66bb6a',  // green
  M: '#fbc02d',  // amber
  L: '#f57c00',  // orange
  XL: '#c62828', // red
  None: '#9e9e9e', // gray
};

export const colorForSize = (size: TshirtSize): string => SIZE_COLORS[size];

/**
 * The point-range label we show next to each size in tooltips/legends.
 */
export const SIZE_RANGE_LABEL: Record<TshirtSize, string> = {
  XS: '≤ 5 pts',
  S: '6–15 pts',
  M: '16–25 pts',
  L: '26–40 pts',
  XL: '41+ pts',
  None: 'no estimate',
};
