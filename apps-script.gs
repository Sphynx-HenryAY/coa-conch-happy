/**
 * Google Sheet bridge for 賭螺預測器 (Conch Predictor).
 *
 * One-time setup (done once by the site owner, not by each user):
 *   1. Create a standalone Apps Script project at https://script.google.com
 *   2. Delete the sample code, paste this whole file, and save.
 *   3. Deploy → New deployment → Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Paste the Web App URL (ends with /exec) into the app's
 *      Settings → Google Sheet sync → Advanced → service URL.
 *
 * Users then only paste their Google Sheet link. The Sheet must be shared as
 * "Anyone with the link → Editor" so this script (running as the site owner)
 * can read and write it without being added as a person.
 *
 * Optional:
 *   - Set TOKEN below and enter the same value in the app's advanced settings.
 *   - Set SHEET_NAME to sync a specific tab (empty = first tab).
 *   - Set SPREADSHEET_ID as a fallback when no sheet link is sent by the app.
 */

const TOKEN = "";
const SHEET_NAME = "";
const SPREADSHEET_ID = "";

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetIdFrom_(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return "";
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  const match = s.match(/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/i);
  return match ? match[1] : "";
}

function book_(value) {
  const id = sheetIdFrom_(value) || SPREADSHEET_ID;
  if (id) {
    const book = SpreadsheetApp.openById(id);
    if (!book) throw new Error("Spreadsheet not found or not shared with the script owner.");
    return book;
  }
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error("No spreadsheet. Paste a Google Sheet link, or set SPREADSHEET_ID.");
  return book;
}

function sheet_(book) {
  const target = book || book_();
  if (SHEET_NAME) {
    const existing = target.getSheetByName(SHEET_NAME);
    return existing || target.insertSheet(SHEET_NAME);
  }
  const sheets = target.getSheets();
  return sheets.length ? sheets[0] : target.insertSheet();
}

function tokenOk_(token) {
  return !TOKEN || String(token == null ? "" : token) === TOKEN;
}

function meta_(book) {
  const target = book || book_();
  return {
    spreadsheetId: target.getId(),
    spreadsheetName: target.getName(),
    spreadsheetUrl: target.getUrl(),
    sheetName: sheet_(target).getName()
  };
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!tokenOk_(params.token)) return json_({ ok: false, error: "Invalid token" });
    const action = params.action || "load";
    const requestedId = params.spreadsheetId || params.sheetUrl || params.id || "";
    if (action === "ping") return json_({ ok: true, action: action, ...meta_(book_(requestedId)) });
    if (action !== "load") return json_({ ok: false, error: "Unknown action: " + action });
    const book = book_(requestedId);
    const values = sheet_(book).getDataRange().getDisplayValues();
    return json_({ ok: true, action: action, values: values, ...meta_(book) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "Invalid JSON body" });
  }
  if (!tokenOk_(body.token)) return json_({ ok: false, error: "Invalid token" });
  const action = body.action || "";
  if (action !== "save") return json_({ ok: false, error: "Unknown action: " + action });

  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || !rows.length) return json_({ ok: false, error: "No rows to save" });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const book = book_(body.spreadsheetId || body.sheetUrl || body.id || "");
    const sheet = sheet_(book);
    const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    if (!width) return json_({ ok: false, error: "No columns to save" });

    const values = rows.map(function (row) {
      const cells = [];
      for (let i = 0; i < width; i++) {
        const value = Array.isArray(row) && row[i] != null ? row[i] : "";
        cells.push(String(value));
      }
      return cells;
    });

    // Write the new table first, then clear only the old cells that are
    // no longer covered. This avoids losing data if something fails midway.
    const oldRows = sheet.getLastRow();
    const oldCols = sheet.getLastColumn();
    sheet.getRange(1, 1, values.length, width).setValues(values);
    if (oldRows > values.length) {
      sheet.getRange(values.length + 1, 1, oldRows - values.length, Math.max(oldCols, width)).clearContent();
    }
    if (oldCols > width) {
      sheet.getRange(1, width + 1, values.length, oldCols - width).clearContent();
    }
    SpreadsheetApp.flush();
    return json_({
      ok: true,
      action: action,
      count: Math.max(0, values.length - 1),
      ...meta_(book)
    });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (err) { /* ignore */ }
  }
}
