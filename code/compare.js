$(document).ready(function () {
	
	var subStr = window.location.search.match("item=(.*)");
	var compareItem = decodeURIComponent(subStr[1]);
	window.document.title = "COMPARING ------ " + compareItem + " ------  This Org < -- > Other Org"
	$('#compare').mergely({
		width: 'auto',
		height: 'auto',
		ignorews: true,
		cmsettings: { readOnly: false, lineNumbers: true },
		lhs: function(setValue) {
			setValue('Loading...');
		},
		rhs: function(setValue) {
			setValue('Loading...');
		}
	});
	

	
	
	
	chrome.runtime.onMessage.addListener(
		  function(request, sender, sendResponse) {
			 //console.log(request);
			 if (request.err){
				 $('#compare').innerHTML('Error getting data');
				 return false;
			 }
			 if (request.setSide) {
				 //console.log(compareItem + ' ' + request.compareItem);
				 if (compareItem  && compareItem!=request.compareItem) {				 
					return false;
				 }

				var zip = new JSZip();
				var allFileData = '';
				zip.loadAsync(request.content.zipFile, {base64: true}).then (function(zip) {

					Object.keys(zip.files).forEach(function (filename) {
						if (!filename.endsWith('package.xml')) {
							zip.files[filename].async('string').then(function (fileData) {
								//console.log(fileData)
								allFileData += '\r\n--------------------------  ' + filename.substring(filename.lastIndexOf('/')+1) + '  ----------------------------\r\n';
								allFileData += fileData;
								$('#compare').mergely(request.setSide, allFileData);
							})
					}
					})
				});
				return false;
			}

	});  
});