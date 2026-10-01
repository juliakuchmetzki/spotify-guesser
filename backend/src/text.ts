/** Kleinschreibung, ohne Akzente/Satzzeichen, einfache Leerzeichen. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Entfernt Zusätze wie "(feat. X)", "[Live]" oder " - Remastered 2011". */
export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
  return cleaned || title;
}

export function splitArtists(artist: string): string[] {
  return artist.split(', ').filter(Boolean);
}
