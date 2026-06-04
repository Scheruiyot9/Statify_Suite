/**
 * exportToExcel — client-side Excel export via SheetJS (xlsx)
 *
 * @param {string}   filename  - File name without extension
 * @param {object[]} rows      - Array of plain objects (each key = column)
 * @param {string[]} [headers] - Optional ordered list of keys to include (all by default)
 * @param {string[]} [labels]  - Optional display labels matching headers order
 */
export function exportToExcel(filename, rows, headers, labels) {
  // Lazy-import so the bundle doesn't pay for xlsx unless export is used
  import('xlsx').then(({ utils, writeFile }) => {
    if (!rows?.length) return;

    const keys = headers ?? Object.keys(rows[0]);
    const head = labels  ?? keys;

    const wsData = [
      head,
      ...rows.map((r) => keys.map((k) => r[k] ?? '')),
    ];

    const ws = utils.aoa_to_sheet(wsData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Sheet1');
    writeFile(wb, `${filename}.xlsx`);
  });
}
