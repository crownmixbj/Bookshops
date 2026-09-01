import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { OrderView } from '../types/db';
import { SUPPORT } from './support';

/** ₦ with thousands separators, two decimals — receipts want the kobo. */
function naira(value: number): string {
  return '₦' + value.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Anything interpolated into the invoice HTML comes from the database —
 * a school name, an item title, a vendor's address — so it is escaped
 * rather than trusted. A quote mark in a book title would otherwise
 * break the markup, and a script tag would do worse.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the invoice as a self-contained HTML document.
 *
 * Kept separate from the printing so it can be unit-tested, and so a
 * receipt preview can render the same markup the PDF will contain.
 */
export function buildInvoiceHtml(order: OrderView): string {
  const lines = order.items
    .map((item) => {
      const lineTotal = item.unit_price == null ? null : item.unit_price * item.quantity;
      return `
        <tr>
          <td>${esc(item.title)}</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${item.unit_price == null ? '—' : naira(item.unit_price)}</td>
          <td class="num">${lineTotal == null ? '—' : naira(lineTotal)}</td>
        </tr>`;
    })
    .join('');

  // `amount` is what was actually agreed; the item sum is only a
  // fallback for an order placed before amounts were recorded.
  const total = order.amount ?? order.itemsTotal;

  const deliveryBlock = order.delivery_address
    ? `
      <div class="block">
        <h2>Deliver to</h2>
        <p>${esc(order.delivery_name)}<br/>
           ${esc(order.delivery_address)}<br/>
           ${esc(order.delivery_city)}<br/>
           ${esc(order.delivery_phone)}</p>
      </div>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #152238; margin: 0; padding: 36px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #1E3A6E; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 800; color: #1E3A6E; letter-spacing: .5px; }
  .brand span { color: #F2762E; }
  .ref { text-align: right; font-size: 12px; color: #5B6B85; }
  .ref strong { display: block; font-size: 15px; color: #152238; }
  .cols { display: flex; gap: 32px; margin-bottom: 24px; }
  .block { flex: 1; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .6px;
       color: #5B6B85; margin: 0 0 6px; }
  p { margin: 0; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
       color: #5B6B85; border-bottom: 1px solid #DCE3ED; padding: 8px 6px; }
  td { padding: 9px 6px; border-bottom: 1px solid #EEF1F6; }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { border: 0; padding-top: 14px; font-weight: 700; font-size: 15px; }
  tfoot .label { text-align: right; color: #5B6B85; font-weight: 600; font-size: 13px; }
  .foot { margin-top: 32px; padding-top: 14px; border-top: 1px solid #DCE3ED;
          font-size: 11px; color: #8B99AE; line-height: 1.6; }
  .status { display: inline-block; padding: 3px 9px; border-radius: 5px; font-size: 11px;
            font-weight: 700; background: #E4F2E8; color: #1F9254; }
</style></head>
<body>
  <div class="head">
    <div>
      <div class="brand">LOCI<span>-BOOK</span></div>
      <div style="color:#5B6B85;margin-top:2px;">School Supply &amp; Book Marketplace</div>
    </div>
    <div class="ref">
      Order reference<strong>${esc(order.reference)}</strong>
      Placed ${esc(formatDate(order.placed_at ?? order.created_at))}<br/>
      <span class="status">${esc(order.payment_status)}</span>
    </div>
  </div>

  <div class="cols">
    <div class="block">
      <h2>Vendor</h2>
      <p>${esc(order.vendor?.store_name ?? 'Vendor')}<br/>
         ${esc([order.vendor?.address, order.vendor?.city].filter(Boolean).join(', '))}<br/>
         ${esc(order.vendor?.phone ?? '')}</p>
    </div>
    ${deliveryBlock}
    <div class="block">
      <h2>Booklist</h2>
      <p>${esc(order.request?.school_name ?? '—')}<br/>
         ${esc(order.request?.class_level ?? '')}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr>
    </thead>
    <tbody>${lines || '<tr><td colspan="4" style="color:#8B99AE">No itemised lines recorded for this order.</td></tr>'}</tbody>
    <tfoot>
      <tr><td colspan="3" class="label">Total (${esc(order.currency)})</td>
          <td class="num">${naira(total)}</td></tr>
    </tfoot>
  </table>

  <div class="foot">
    ${order.amount == null
      ? 'This total is the sum of the recorded line items; no agreed order amount was stored for this order.<br/>'
      : ''}
    Questions about this order? ${esc(SUPPORT.phoneDisplay)} · ${esc(SUPPORT.email)}<br/>
    Generated by LOCI-BOOK on ${esc(formatDate(new Date().toISOString()))}.
  </div>
</body></html>`;
}

export interface InvoiceResult {
  ok: boolean;
  /** Set when a file was written (native only). */
  uri?: string;
  message?: string;
}

/**
 * Renders the invoice to a PDF and hands it to the user.
 *
 * Two platforms, two behaviours, both via expo-print:
 *   web     printToFileAsync is unavailable, so we open the browser's
 *           print dialog — from there the user picks "Save as PDF".
 *   native  print to a file, then offer the share sheet so it can be
 *           saved to Files, mailed, or sent on.
 */
export async function downloadInvoice(order: OrderView): Promise<InvoiceResult> {
  const html = buildInvoiceHtml(order);

  try {
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
      return { ok: true, message: 'Choose "Save as PDF" in the print dialog.' };
    }

    const { uri } = await Print.printToFileAsync({ html, base64: false });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Invoice ${order.reference}`,
        UTI: 'com.adobe.pdf',
      });
      return { ok: true, uri };
    }

    return { ok: true, uri, message: `Saved to ${uri}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
