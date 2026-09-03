/**
 * Tiering is the rule that keeps the corpus honest. The live site submits
 * 13,881 URLs and Google indexes 4,840 of them: most of those pages exist only
 * because two clubs share a division, not because a fixture was ever played.
 *
 *   T1  fixture scheduled inside 10 days and priced   -> index, in sitemap, revalidate fast
 *   T2  played inside 90 days, or scheduled further out -> index, in sitemap, daily
 *   T3  the pair has met, but not inside 90 days      -> noindex/follow, not in sitemap
 *   T4  no fixture on record in either direction      -> 410 Gone
 *
 * 410 rather than 301: a pairing that has never happened has no equivalent page
 * to redirect to, and redirecting it to the league hub teaches Google that our
 * URLs are unreliable.
 */
export type Tier = 1 | 2 | 3 | 4;

const DAY = 86_400_000;

export function tierFor(opts: {
  nextKickoff?: Date | null;
  lastPlayed?: Date | null;
  priced: boolean;
  now?: Date;
}): Tier {
  const now = opts.now ?? new Date();
  const { nextKickoff, lastPlayed, priced } = opts;

  if (nextKickoff) {
    const days = (nextKickoff.getTime() - now.getTime()) / DAY;
    if (days <= 10 && priced) return 1;
    return 2;
  }
  if (lastPlayed) {
    const days = (now.getTime() - lastPlayed.getTime()) / DAY;
    if (days <= 90) return 2;
    return 3;
  }
  return 4;
}

export function robotsFor(tier: Tier) {
  return tier <= 2
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

/** How long a rendered page may be served before it is rebuilt. */
export function revalidateFor(tier: Tier): number {
  switch (tier) {
    case 1: return 900;      // 15 min — prices move
    case 2: return 21_600;   // 6 h
    default: return 604_800; // a week
  }
}
