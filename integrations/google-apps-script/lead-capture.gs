const SHEET_NAME = 'Tapntrust Leads';
const SPREADSHEET_ID_PROPERTY = 'TAPNTRUST_LEADS_SPREADSHEET_ID';
const HEADERS = [
  'Email', 'Sign Up Date', 'Sign Up Time', 'Visitor ID',
  'Add to Cart', 'Add to Cart Date/Time', 'Go to Checkout', 'Checkout Date/Time',
  'Last Event', 'Discount Code', 'Discount %', 'Landing Page', 'Referrer', 'Updated At'
];

function setupTapntrustLeadSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open the target Google Sheet before running setup.');
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId());
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
}

function doGet() {
  return json_({ ok: true, service: 'Tapntrust lead capture' });
}

function doPost(e) {
  try {
    const data = parseBody_(e);
    const email = clean_(data.email).toLowerCase();
    const visitorId = clean_(data.visitorId);
    const eventName = clean_(data.event);
    const occurredAt = clean_(data.occurredAt) || new Date().toISOString();

    if (!visitorId || !['signup', 'add_to_cart', 'checkout'].includes(eventName)) {
      return json_({ ok: false, error: 'Invalid event.' });
    }
    if (eventName === 'signup' && !isEmail_(email)) {
      return json_({ ok: false, error: 'Invalid email.' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getLeadSheet_();
      ensureHeaders_(sheet);
      const rowNumber = findLeadRow_(sheet, visitorId, email);
      const row = rowNumber ? sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0] : new Array(HEADERS.length).fill('');
      const resolvedEmail = email || clean_(row[0]);
      if (!resolvedEmail) return json_({ ok: true, deferred: true });

      const signupDate = eventName === 'signup' ? formatDate_(occurredAt, 'dd/MM/yyyy') : row[1];
      const signupTime = eventName === 'signup' ? formatDate_(occurredAt, 'HH:mm:ss') : row[2];
      const addToCartAt = clean_(data.addToCartAt) || (eventName === 'add_to_cart' ? occurredAt : clean_(row[5]));
      const checkoutAt = clean_(data.checkoutAt) || (eventName === 'checkout' ? occurredAt : clean_(row[7]));

      const values = [
        resolvedEmail, signupDate, signupTime, visitorId,
        addToCartAt ? 'YES' : '', addToCartAt ? formatDate_(addToCartAt, 'dd/MM/yyyy HH:mm:ss') : '',
        checkoutAt ? 'YES' : '', checkoutAt ? formatDate_(checkoutAt, 'dd/MM/yyyy HH:mm:ss') : '',
        eventName,
        clean_(data.discountCode) || clean_(row[9]),
        data.discountPercent !== undefined && data.discountPercent !== '' ? Number(data.discountPercent) : row[10],
        clean_(data.page) || clean_(row[11]), clean_(data.referrer) || clean_(row[12]),
        formatDate_(new Date().toISOString(), 'dd/MM/yyyy HH:mm:ss')
      ];

      if (rowNumber) sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([values]);
      else sheet.appendRow(values);
      return json_({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: 'Server error.' });
  }
}

function getLeadSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_PROPERTY);
  if (!spreadsheetId) throw new Error('Run setupTapntrustLeadSheet() once before deploying the Web App.');
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}
function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (!HEADERS.every((header, index) => current[index] === header)) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}
function findLeadRow_(sheet, visitorId, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const normalEmail = clean_(email).toLowerCase();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (visitorId && clean_(values[index][3]) === visitorId) return index + 2;
    if (normalEmail && clean_(values[index][0]).toLowerCase() === normalEmail) return index + 2;
  }
  return 0;
}
function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  try { return JSON.parse(raw); } catch { return {}; }
}
function isEmail_(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function clean_(value) { return String(value === null || value === undefined ? '' : value).trim(); }
function formatDate_(value, pattern) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Australia/Melbourne', pattern);
}
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
