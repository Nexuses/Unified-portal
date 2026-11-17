import ExcelJS from "exceljs";
import { recordsToCloudList } from "@/lib/cloud-sheet-csv";

export const CLOUD_XLSX_MAX_BYTES = 5 * 1024 * 1024;

function cellText(cell: ExcelJS.Cell) {
  try {
    return String(cell.text ?? "");
  } catch {
    return String(cell.value ?? "");
  }
}

/**
 * Read the first visible sheet of an Excel workbook as a people list. Hidden rows and columns
 * are skipped, the same as a Google Sheet with hidden columns.
 */
export async function parseCloudXlsx(data: Buffer) {
  if (data.length > CLOUD_XLSX_MAX_BYTES) {
    throw new Error("That Excel file is larger than 5 MB. Remove extra sheets or columns.");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new Error("Couldn't open that Excel file. Save it as .xlsx (or CSV) and try again.");
  }
  const sheet =
    workbook.worksheets.find((ws) => ws.state === "visible" && ws.actualRowCount > 0) ||
    workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const records: string[][] = [];
  const width = sheet.columnCount;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.hidden) return;
    const values: string[] = [];
    for (let c = 1; c <= width; c += 1) {
      values.push(sheet.getColumn(c).hidden ? "" : cellText(row.getCell(c)));
    }
    records.push(values);
  });
  if (records.length < 2) throw new Error("The sheet needs a header row and at least one person.");
  return recordsToCloudList(records);
}
