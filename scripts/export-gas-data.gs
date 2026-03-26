/**
 * GAS에서 실행: 모든 시트를 CSV로 Google Drive에 저장
 * 사용법: GAS 에디터에서 exportAllSheets() 실행
 */

function exportAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = DriveApp.createFolder('momentrix_export_' + new Date().toISOString().slice(0, 10));
  var sheets = ss.getSheets();

  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    var data = sheet.getDataRange().getValues();
    if (data.length === 0) return;

    var csv = data.map(function(row) {
      return row.map(function(cell) {
        var val = (cell instanceof Date)
          ? Utilities.formatDate(cell, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
          : String(cell);
        // Escape CSV
        if (val.indexOf(',') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',');
    }).join('\n');

    folder.createFile(name + '.csv', csv, MimeType.CSV);
    Logger.log('Exported: ' + name + ' (' + data.length + ' rows)');
  });

  Logger.log('All sheets exported to folder: ' + folder.getUrl());
  return folder.getUrl();
}
