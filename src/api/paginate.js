// The newest `limit` rows of a history table, returned oldest-first as every caller expects.
// Two traps this exists to avoid: `.order(asc).limit(n)` keeps the OLDEST n rows, so once a
// history outgrew the limit its newest rows silently vanished; and the API caps every response
// (Supabase's "Max rows", 1000 by default) whatever `.limit()` asks for, which put the real
// cutoff far below the one written in the code.
//
// `fetchPage(from, to, withCount)` runs one newest-first query over the inclusive range and
// resolves `{ data, count }`; `count` is only asked for on the first page.
export async function newestFirst(fetchPage, limit, pageSize = 1000) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;

  while (offset < Math.min(total, limit)) {
    const to = Math.min(offset + pageSize, limit) - 1;
    const { data, count } = await fetchPage(offset, to, offset === 0);
    if (offset === 0 && count != null) total = count;
    // An empty page is the end even when `count` was unavailable.
    if (!data?.length) break;
    // A row logged between two page reads shifts every offset by one, repeating a row.
    for (const row of data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    offset += data.length;
  }

  return rows.slice(0, limit).reverse();
}
