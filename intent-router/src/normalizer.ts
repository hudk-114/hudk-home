function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
}

export function normalizeText(text: string, fillers: string[] = []): string {
  let normalized = toHalfWidth(text).trim().toLowerCase();
  for (const filler of fillers) {
    normalized = normalized.replaceAll(filler.toLowerCase(), "");
  }
  return normalized
    .replace(/[\s,，。！？!?、；;：:]+/g, "")
    .replace(/[“”‘’"']/g, "");
}
