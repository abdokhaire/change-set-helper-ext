// Saves options to chrome.storage
function save_options() {
  var salesforceApiVersion = document.getElementById('salesforceApiVersion').value;

  chrome.storage.sync.set({
    salesforceApiVersion: salesforceApiVersion,
  }, function() {
    // Update status to let user know options were saved.
    var status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(function() {
      status.textContent = '';
    }, 750);
  });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
  chrome.storage.sync.get(['salesforceApiVersion']
  , function(items) {
    const versionPattern = RegExp('^[0-9][0-9]\.0$');
    var apiversion = versionPattern.test(items.salesforceApiVersion) ? items.salesforceApiVersion : '48.0';
    document.getElementById('salesforceApiVersion').value = apiversion;
  });
}
document.addEventListener('DOMContentLoaded', restore_options);
var form = document.getElementById('form');
form.onsubmit = save_options;
