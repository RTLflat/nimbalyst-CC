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

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.company) return json_({ error: 'rejected' }); // honeypot
  var type = String(p.type || '');
  var title = String(p.title || '').trim();
  if (CREATABLE.indexOf(type) === -1) return json_({ error: 'Invalid type' });
  if (!title) return json_({ error: 'Title is required' });
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
  return json_({ ok: true });
}
