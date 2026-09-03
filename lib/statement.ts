import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { PayoutRequest } from '../hooks/useVendorPayouts';

/**
 * One CSV field.
 *
 * Quoting is not cosmetic. A bank name with a comma in it would shift
 * every later column by one, and a leading =, + or - makes Excel treat
 * the cell as a formula — the CSV injection that turns a statement into
 * something that runs when opened. Prefixing an apostrophe defuses it.
 */
function cell(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

const COLUMNS = ['Date', 'Reference', 'Amount (NGN)', 'Currency', 'Status', 'Bank', 'Account', 'Processed', 'Failure reason'];

export function buildPayoutCsv(rows: PayoutRequest[]): string {
  const lines = [COLUMNS.map(cell).join(',')];
  for (const p of rows) {
    lines.push(
      [
        new Date(p.requested_at).toISOString().slice(0, 10),
        p.reference,
        // A plain number, so a spreadsheet can add it up. The ₦ symbol
        // belongs on screen, not in a data column.
        Number(p.amount).toFixed(2),
        p.currency,
        p.status,
        p.bank_name ?? '',
        p.account_last4 ? '****' + p.account_last4 : '',
        p.processed_at ? new Date(p.processed_at).toISOString().slice(0, 10) : '',
        p.failure_reason ?? '',
      ]
        .map(cell)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

export interface StatementResult {
  ok: boolean;
  message?: string;
}

/**
 * Saves the payout history as a CSV.
 *
 * This is a real export, not a placeholder button: the rows already on
 * screen are the rows in the file. On web it downloads through a blob;
 * on a device it writes a file and offers the share sheet, the same
 * shape as downloadInvoice in lib/invoice.ts.
 */
export async function exportPayoutStatement(rows: PayoutRequest[]): Promise<StatementResult> {
  if (rows.length === 0) return { ok: false, message: 'There are no payouts to export.' };

  const csv = buildPayoutCsv(rows);
  const filename = `loci-payouts-${new Date().toISOString().slice(0, 10)}.csv`;

  try {
    if (Platform.OS === 'web') {
      // ﻿ so Excel reads it as UTF-8 rather than mangling any
      // non-ASCII bank name.
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { ok: true };
    }

    // SDK 54 replaced writeAsStringAsync with the File/Paths classes.
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(csv);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Payout statement',
        UTI: 'public.comma-separated-values-text',
      });
      return { ok: true };
    }
    return { ok: true, message: `Saved to ${file.uri}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
