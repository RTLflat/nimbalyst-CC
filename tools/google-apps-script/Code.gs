// tools/google-apps-script/Code.gs
var CREATABLE = ['bug', 'task', 'idea', 'decision', 'plan', 'feature'];
var HEADER = ['Timestamp', 'RowId', 'Type', 'Title', 'CommandFeature', 'Description'];

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function ensureHeader_(sh) {
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.api === 'rows') {
    var required = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
    if (required && params.token !== required) return json_({ error: 'unauthorized' });
    var sh = sheet_();
    ensureHeader_(sh);
    var values = sh.getDataRange().getValues();
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      rows.push({
        rowId: String(r[1] || ''),
        type: String(r[2] || ''),
        title: String(r[3] || ''),
        commandFeature: String(r[4] || ''),
        description: String(r[5] || ''),
      });
    }
    return json_({ rows: rows });
  }
  var t = HtmlService.createTemplateFromFile('form');
  t.types = CREATABLE;
  return t.evaluate().setTitle('Submit a tracker item');
}

// Shared submission logic. Returns a PLAIN object so it can be called directly
// over the google.script.run bridge from the form (which cannot read a
// ContentService.TextOutput).
function submitForm(p) {
  p = p || {};
  if (p.company) return { error: 'rejected' }; // honeypot
  var type = String(p.type || '');
  var title = String(p.title || '').trim();
  if (CREATABLE.indexOf(type) === -1) return { error: 'Invalid type' };
  if (!title) return { error: 'Title is required' };
  var sh = sheet_();
  ensureHeader_(sh);
  sh.appendRow([
    new Date(),
    Utilities.getUuid(),
    type,
    title,
    String(p.commandFeature || '').trim(),
    String(p.description || '').trim(),
  ]);
  return { ok: true };
}

// HTTP entry point for external clients; wraps the plain result as JSON.
// The served form calls submitForm() directly via google.script.run, not this.
function doPost(e) {
  return json_(submitForm((e && e.parameter) || {}));
}
