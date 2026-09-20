// Provider line numbers refer to the submitted patch. Only additions become diagnostics.
export function addedLineMap(diff: string): Map<number, number> {
  const map = new Map<number, number>();
  let line: number | undefined;
  diff.split(/\r?\n/).forEach((text, index) => {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      return;
    }
    if (line === undefined) return;
    if (text.startsWith("+")) map.set(index + 1, line++);
    else if (text.startsWith(" ")) line++;
  });
  return map;
}
