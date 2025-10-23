var changeSetTable = null;
var typeColumn = null;
var nameColumn = null;
var numCallsInProgress = 0;
var totalComponentCount = 0; // Track total rows loaded for pagination decisions
var isLoadingMorePages = false; // Flag to indicate we're still loading pages in background
var cachedMetadataResults = []; // Store metadata results to reuse during pagination

var entityTypeMap = {
    'TabSet': 'CustomApplication',
    'ApexClass': 'ApexClass',
    'ApexComponent': 'ApexComponent',
    'ApexPage': 'ApexPage',
    'ApexTrigger': 'ApexTrigger',
    'AssignmentRule': 'AssignmentRules',
    'AuraDefinitionBundle': 'AuraDefinitionBundle',
    'AuthProvider': 'AuthProvider',
    'AutoResponseRule': 'AutoResponseRules',
    'CallCenter': 'CallCenter',
    'Community': 'Community',
    'CompactLayout': 'CompactLayout',
    'CorsWhitelistEntry': 'CorsWhitelistOrigin',
    'CustomEntityDefinition': 'CustomObject',
    'CustomFieldDefinition': 'CustomField',
    'CustomObjectCriteriaSharingRule': 'SharingCriteriaRule',
    'CustomReportType': 'ReportType',
    'CustomShareRowCause': 'SharingReason',
    'CustomTabDefinition': 'CustomTab',
    'Dashboard': 'Dashboard',
    'Document': 'Document',
    'EmailTemplate': 'EmailTemplate',
    'FieldSet': 'FieldSet',
    'FlexiPage': 'FlexiPage',
    'FlowDefinition': 'FlowDefinition',
    'Group': 'Group',
    'Layout': 'Layout',
    'LightningComponentBundle': 'LightningComponentBundle',
    'ListView': 'ListView',
    'MatchingRule': 'MatchingRule',
    'NamedCredential': 'NamedCredential',
    'PageComponent': 'HomePageComponent',
    'PermissionSet': 'PermissionSet',
    'PlatformCachePartition': 'PlatformCachePartition',
    'ProcessDefinition': 'ApprovalProcess',
    'Queues': 'Queue',
    'QuickActionDefinition': 'QuickAction',
    'RecordType': 'RecordType',
    'SharedPicklistDefinition': 'GlobalValueSet',
    'SharingSet': 'SharingSet',
    'Site': 'SiteDotCom',
    'StaticResource': 'StaticResource',
    'ValidationFormula': 'ValidationRule',
    'WebLink': 'WebLink',
    'WorkflowRule': 'WorkflowRule',
    'ActionFieldUpdate': 'WorkflowFieldUpdate',
    'ActionTask': 'WorkflowTask',
    'ActionEmail': 'WorkflowAlert',
    'Report': 'Report',
    'ExternalString': 'CustomLabel',
}

//as Dashboard, Document,
//EmailTemplate, or Report.
var entityFolderMap = {
    'Report': 'ReportFolder',
    'Document': 'DocumentFolder',
    'EmailTemplate': 'EmailFolder',
    'Dashboard': 'DashboardFolder'
}


// Helper function to add columns to specific rows (avoids freezing with large datasets)
function addColumnsToRows(rows) {
    if (typeColumn.length == 0) {
        rows.append("<td>&nbsp;</td>");
    }
    rows.append("<td>Unknown</td>"); // Folder
    rows.append("<td>Unknown</td>"); // Date Modified
    rows.append("<td>Unknown</td>"); // Modified by
    rows.append("<td>&nbsp;</td>");  // Compare Date Modified
    rows.append("<td>&nbsp;</td>");  // Compare Modified by
    rows.append("<td>Unknown</td>"); // Full name
}

function setupTable() {
    typeColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Type')");
    nameColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Name')");

    // Add header columns (only once)
    if (typeColumn.length == 0) {
        $("table.list tr.headerRow").append("<td>&nbsp;</td>");
    }
    $("table.list tr.headerRow").append("<td>Folder</td>");
    $("table.list tr.headerRow").append("<td>Date Modified</td>");
    $("table.list tr.headerRow").append("<td>Modified by</td>");
    $("table.list tr.headerRow").append("<td><span class='compareOrgName'></span> Date Modified</td>");
    $("table.list tr.headerRow").append("<td><span class='compareOrgName'></span> Modified by</td>");
    $("table.list tr.headerRow").append("<td>Full name</td>");

    // Add columns only to existing rows (not ALL rows to avoid freeze)
    var existingRows = $("table.list tr.dataRow");
    addColumnsToRows(existingRows);

    var changeSetHead = $('<thead></thead>').prependTo('table.list').append($('table.list tr:first'));
    changeSetHead.after('<tfoot><tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tfoot>');

    var gotoloc1 = "'/" + $("#id").val() + "?tab=PackageComponents&rowsperpage=5000'";
    $('input[name="cancel"]')
        .before('<input value="View change set" class="btn" name="viewall" title="View all items in changeset in new window" type="button" onclick="window.open(' + gotoloc1 +',\'_blank\');" />')
        .after(`<br /><input value="Compare with org" class="btn compareorg" name="compareorg" id="compareorg"
					title="Compare wtih another org. A login box will be displayed." type="button" />
		<select id='compareEnv' name='Compare Environment'>
			<option value='sandbox'>Sandbox</option>
			<option value='prod'>Prod/Dev</option>
		</select>
	<span id="loggedInUsername"></span>  <span id="logout">(<a id="logoutLink" href="#">Logout</a>)</span>
`);

    $('#editPage').append('<input type="hidden" name="rowsperpage" value="5000" /> ');
}

function convertDate(dateToconvert) {
    var momentDate = new moment(dateToconvert);
    return momentDate.format("DD MMM YYYY");

}

function convertToMoment(stringToconvert) {
    var momentDate = new moment(stringToconvert, "DD MMM YYYY");
    return momentDate;
}


function processListResults(response) {
    //console.log(response);
    var results = [];
    if (response.results && !Array.isArray(response.results)) {
        results.push(response.results);
    } else {
        results = response.results;
    }
    var len = results ? results.length : 0;

    // Cache metadata results for reuse during pagination
    // Merge new results with cached results (dedupe by id)
    for (i = 0; i < len; i++) {
        var existingIndex = cachedMetadataResults.findIndex(r => r.id === results[i].id);
        if (existingIndex === -1) {
            cachedMetadataResults.push(results[i]);
        }
    }

    // Apply metadata to matching rows in the table
    applyMetadataToRows(results);

    numCallsInProgress--;

    // Only create table if it doesn't exist yet (first time)
    // During progressive loading, table is already created
    if (numCallsInProgress <= 0 && !changeSetTable) {
        createDataTable();
    }

}

// Apply metadata to rows in the table
function applyMetadataToRows(results) {
    for (i = 0; i < results.length; i++) {
        shortid = results[i].id.slice(0, -3);
        var matchingInput = $("input[value='" + shortid + "']");
        dateMod = new Date(results[i].lastModifiedDate);
        var fullName = results[i].fullName;
        var folderName = fullName.substring(0, fullName.lastIndexOf("/"));
        dateCreate = new Date(results[i].createdDate);

        matchingInput.first().closest('tr').children('td:eq(2)').text(folderName);
        matchingInput.first().closest('tr').children('td:eq(3)').text(convertDate(dateMod));
        matchingInput.first().closest('tr').children('td:eq(4)').text(results[i].lastModifiedByName);
        //matchingInput.first().closest('tr').children('td:eq(5)').text(convertDate(dateCreate));
        //matchingInput.first().closest('tr').children('td:eq(6)').text(results[i].createdByName);
        matchingInput.first().closest('tr').children('td:eq(7)').text(fullName);
        matchingInput.first().closest('tr').children('td:eq(7)').attr("data-fullName", fullName);
        matchingInput.first().closest('tr').children('td:eq(7)').addClass("fullNameClass");
    }
}

function jq(myid) {
    return "#" + myid.replace(/(:|\.|\[|\]|,)/g, "\\$1");
}

function processCompareResults(results, env) {
    //console.log(results);

    changeSetTable.column(2).visible(true);
    changeSetTable.column(6).visible(true);
    changeSetTable.column(7).visible(true);
    if (env == 'prod') {
        $('.compareOrgName').text('(Prod/Dev)');
    } else {
        $('.compareOrgName').text('(Sandbox)');
    }
    $(changeSetTable.column(8).header()).text('Full name (Click for diff)');

    for (i = 0; i < results.length; i++) {
        var fullName = results[i].fullName;
        var matchingInput = $('td[data-fullName = "' + fullName + '"]');
        //var matchingInput = $( jq(fullName));
        //console.debug(changeSetTable.cell(  jq(fullName) ));
        if (matchingInput.length > 0) {
            var rowIdx = changeSetTable.cell('td[data-fullName = "' + fullName + '"]').index().row;

            //console.log(matchingInput);
            //selector = "a[href='/" + shortid + "']";
            dateMod = new Date(results[i].lastModifiedDate);
            console.debug(rowIdx);
            console.debug(changeSetTable.row(rowIdx).column(6));
            changeSetTable.cell(rowIdx, 6).data(convertDate(dateMod));
            changeSetTable.cell(rowIdx, 7).data(results[i].lastModifiedByName);
            changeSetTable.cell(rowIdx, 8).data('<a href="#">' + fullName + '</a>');
            matchingInput.off("click");
            matchingInput.click(getContents);

            var thisOrgDateMod = changeSetTable.cell(rowIdx, 4).data();
            if (moment(dateMod).diff(convertToMoment(thisOrgDateMod)) < 0) {
                changeSetTable.cell(rowIdx, 4).node().style.color = "green";
            }
        }
    }
    changeSetTable.column(2).visible(false);
    var column = changeSetTable.column(7);
    var select = $(column.footer()).find('select');

    select.find('option')
        .remove()
        .end()
        .append('<option value=""></option>');

    column.data().unique().sort().each(function (d, j) {
        select.append('<option value="' + d + '">' + d + '</option>')
    });

    $("#editPage").removeClass("lowOpacity");
    $("#bodyCell").removeClass("changesetloading");

}

function createDataTable() {
    var hasFolder = false;
    if (selectedEntityType in entityFolderMap) {
        hasFolder = true;
    }

    // Enable pagination for large datasets to improve performance
    // Enable if: 1) We already have enough rows, OR 2) We're still loading more pages (will exceed threshold)
    var enablePaging = totalComponentCount >= ENABLE_PAGINATION_THRESHOLD || isLoadingMorePages;
    var domLayout = enablePaging ? 'lprtip' : 'lrti'; // 'p' at top and bottom for pagination controls

    if (enablePaging) {
        if (isLoadingMorePages) {
            console.log(`Loading more pages - enabling pagination (currently ${totalComponentCount} rows, more coming)`);
        } else {
            console.log(`Large dataset detected (${totalComponentCount} rows) - enabling pagination for better performance`);
        }
    }

    //Create the datatable
    try {
        changeSetTable = $('div.bPageBlock > div.pbBody > table.list').DataTable({
            processing: true,
            paging: enablePaging,
            pageLength: 100,  // Show 100 rows per page when pagination is enabled
            dom: domLayout,
            "order": [[4, "desc"]],
            "deferRender": true,  // Performance optimization for large datasets
            "columns": [
                {"searchable": false, "orderable": false}, //checkbox
                null, //name
                {"visible": typeColumn.length > 0}, //type
                {"visible": hasFolder}, //folder
                {"type": "date"}, //date mod
                null, //mod by
                {"type": "date", "visible": false}, //date create
                {"visible": false}, //created by
                null //full name
            ],
            initComplete: tableInitComplete
        });

        $('<input style="float: left;"  value="Reset Search Filters" class="clearFilters btn" name="Reset Search Filters" title="Reset search filters" type="button" />').prependTo('div.rolodex');
        $(".clearFilters").click(clearFilters);
        $("#editPage").submit(function (event) {
            clearFilters();
            return true;
        });
    } catch (e) {
        console.log(e);
    }

    $("#editPage").removeClass("lowOpacity");
    $("#bodyCell").removeClass("changesetloading");
}

function clearFilters() {
    //console.log(changeSetTable);
    changeSetTable
        .columns().search('')
        .draw();
    $(".dtsearch").val('');
}

/**
 When the list table is added, these functionas are added to the make the columns searchable and selectable.
 **/
function basicTableInitComplete() {
    this.api().columns().every(function () {
        var column = this;
        if ((column.index() == 1)) {
            var searchbox = $('<input class="dtsearch" type="text" placeholder="Search" />')
                .appendTo($(column.footer()))
                .on('keyup change', function () {
                    column
                        .search($(this).val())
                        .draw();
                });
        }

        if ((column.index() == 2)) {
            var select = $('<select class="dtsearch"><option value=""></option></select>')
                .appendTo($(column.footer()))
                .on('change', function () {
                    var val = $.fn.dataTable.util.escapeRegex(
                        $(this).val()
                    );

                    column
                        .search(val ? '^' + val + '$' : '', true, false)
                        .draw();
                })

            column.data().unique().sort().each(function (d, j) {
                select.append('<option value="' + d + '">' + d + '</option>')
            });
        }
        ;
    });
}

/**
 When the list table is added, these functionas are added to the make the columns searchable and selectable.
 **/
function tableInitComplete() {
    this.api().columns().every(function () {
        var column = this;
        //Add select search dropdowns
        if ((column.index() == 2) || column.index() == (3) || column.index() == (5) || column.index() == (7)) {
            var select = $('<select class="dtsearch" ><option value=""></option></select>')
                .appendTo($(column.footer()))
                .on('change', function () {
                    var val = $.fn.dataTable.util.escapeRegex(
                        $(this).val()
                    );

                    column
                        .search(val ? '^' + val + '$' : '', true, false)
                        .draw();
                })

            column.data().unique().sort().each(function (d, j) {
                select.append('<option value="' + d + '">' + d + '</option>')
            });
        }
        ;

        //add text search boxes
        if ((column.index() == 1) || column.index() == (8) || column.index() == (6) || column.index() == (4)) {

            var searchbox = $('<input class="dtsearch" type="text" placeholder="Search" />')
                .appendTo($(column.footer()))
                .on('keyup change', function () {
                    column
                        .search($(this).val())
                        .draw();
                });

        }
        ;
    });
}


function getMetaData(processResultsFunction) {

    if (selectedEntityType in entityFolderMap) {
        $(".compareorg").hide();
        var data = [{type: entityFolderMap[selectedEntityType]}];
        chrome.runtime.sendMessage({'proxyFunction': "listLocalMetaData", 'proxydata': data},
            function (response) {
                results = response.results;

                var folderQueries = [];
                var n = 0;
                for (i = 0; i < results.length; i++) {

                    n++;
                    folderName = results[i].fullName;
                    var folderQuery = {};
                    folderQuery.type = entityTypeMap[selectedEntityType];
                    folderQuery.folder = folderName;
                    folderQueries.push(folderQuery);
                    if (n == 3) {
                        numCallsInProgress++;
                        chrome.runtime.sendMessage({
                                'proxyFunction': "listLocalMetaData",
                                'proxydata': folderQueries
                            },
                            processResultsFunction
                        );

                        folderQueries = [];
                        n = 0;
                    }
                }

                if (n > 0) {
                    numCallsInProgress++;
                    chrome.runtime.sendMessage({
                            'proxyFunction': "listLocalMetaData",
                            'proxydata': folderQueries
                        },
                        processResultsFunction
                    );
                }

            }
        );
    } else {
        numCallsInProgress++;
        chrome.runtime.sendMessage({
                'proxyFunction': "listLocalMetaData",
                'proxydata': [{type: entityTypeMap[selectedEntityType]}]
            },
            processResultsFunction
        );
    }

}

function listMetaDataProxy(data, retFunc, isDefault) {
    if (isDefault) {
        chrome.runtime.sendMessage({'proxyFunction': "listLocalMetaData", 'proxydata': data}, function (response) {
            retFunc(response.results);
        });
    } else {
        chrome.runtime.sendMessage({'proxyFunction': "listDeployMetaData", 'proxydata': data}, function (response) {
            retFunc(response.results);
        });
    }

}


function oauthLogin(env) {
    var env = $("#compareEnv :selected").val();

    chrome.runtime.sendMessage({'oauth': "connectToDeploy", environment: env}, function (response) {
        //console.log(response);
        $("#compareEnv").hide();

        $("#loggedInUsername").html(response.username);
        $("#logout").show();

        listMetaDataProxy([{type: entityTypeMap[selectedEntityType]}],
            function (results) {
                if (results.error) {
                    console.log("Problem logging in: " + results.error);
                    //do nothing else
                }
                $("#editPage").addClass("lowOpacity");
                $("#bodyCell").addClass("changesetloading");

                processCompareResults(results, env);
                //console.log(results);
            },
            false);

    });
}


function getContents() {
    var itemToGet = $(this).attr('data-fullName');
    //(itemToGet);
    chrome.runtime.sendMessage({
            'proxyFunction': "compareContents",
            'entityType': entityTypeMap[selectedEntityType],
            'itemName': itemToGet
        },
        function (response) {
            //do nothing
        }
    );
}

function deployLogout() {
    chrome.runtime.sendMessage({'oauth': 'deployLogout'}, function(response) {
        //console.log(response);
        //do nothing else
    });

    $("#compareEnv").show();
    $("#loggedInUsername").html('');
    $("#logout").hide();


}

//This is the part that runs when loaded!

// Clear cached metadata for fresh load
cachedMetadataResults = [];

var selectedEntityType = $('#entityType').val();
var changeSetId = $("#id").val();
var listTableLength = $("table.list tr.dataRow").length;
var nextPageHref = $('a:contains("Next Page")').first().attr('href');
if (nextPageHref) {
    //nextPageHref = nextPageHref.replace("&lsr=1000", "");
    nextPageHref = serverUrl + '/p/mfpkg/AddToPackageFromChangeMgmtUi' ;
    //console.log(nextPageHref + changeSetId + selectedEntityType);
}
// Async pagination to avoid blocking the browser
var nextPageLsr = 1000;
var shouldContinuePagination = false;
var ENABLE_PAGINATION_THRESHOLD = 1500; // Enable DataTables paging above this threshold

// Show loading overlay and fetch metadata FIRST before showing any rows
if (selectedEntityType in entityTypeMap) {
    // Show loading spinner
    var loadingHtml = `
        <style>
            @keyframes csh-spinner {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
        <div id="csh-loading-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
             background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;">
            <div style="background: white; border: 3px solid #0070d2; border-radius: 8px; padding: 30px;
                 text-align: center; box-shadow: 0 4px 16px rgba(0,0,0,0.3);">
                <div style="width: 60px; height: 60px; border: 6px solid #f3f3f3; border-top: 6px solid #0070d2;
                     border-radius: 50%; margin: 0 auto 20px; animation: csh-spinner 1s linear infinite;"></div>
                <h3 style="margin: 0 0 10px 0; color: #0070d2;">Loading Metadata...</h3>
                <p style="margin: 0; color: #666;">Please wait while we fetch component details</p>
            </div>
        </div>
    `;
    $('body').append(loadingHtml);

    $("#editPage").addClass("lowOpacity");
    $("#bodyCell").addClass("changesetloading");

    // Fetch metadata FIRST
    chrome.runtime.sendMessage({
        "oauth": "connectToLocal",
        "sessionId": sessionId,
        "serverUrl": serverUrl
    }, function (response) {
        // Check for Chrome runtime errors only
        if (chrome.runtime.lastError) {
            console.error('OAuth connection failed:', chrome.runtime.lastError);
            $('#csh-loading-overlay').remove();
            alert('Failed to connect to Salesforce. Please refresh the page and try again.\n\nError: ' +
                  chrome.runtime.lastError.message);
            $("#editPage").removeClass("lowOpacity");
            $("#bodyCell").removeClass("changesetloading");
            return;
        }

        // Check for explicit error in response
        if (response && response.error) {
            console.error('OAuth connection failed:', response.error);
            $('#csh-loading-overlay').remove();
            alert('Failed to connect to Salesforce. Please refresh the page and try again.\n\nError: ' + response.error);
            $("#editPage").removeClass("lowOpacity");
            $("#bodyCell").removeClass("changesetloading");
            return;
        }

        console.log('Fetching metadata before loading rows for type:', selectedEntityType);

        try {
            // Custom callback that waits for all metadata calls to complete
            getMetaData(function(metadataResponse) {
                // Process and cache the metadata!
                processListResults(metadataResponse);

                // Check if ALL metadata calls are complete
                if (numCallsInProgress <= 0) {
                    console.log('All metadata loaded and cached!');

                    // Metadata successfully loaded and cached!
                    $('#csh-loading-overlay').remove();

                    // Check if we need pagination
                    if (listTableLength >= 1000) {
                        // Automatically load all pages without confirmation
                        shouldContinuePagination = true;
                        isLoadingMorePages = true;
                        startPaginationWithMetadata();
                    } else {
                        // Less than 1000 rows - show immediately with metadata
                        totalComponentCount = listTableLength;
                        initializeTableWithMetadata();
                    }
                }
                // Otherwise, wait for more metadata calls to complete
            });
        } catch (error) {
            console.error('Error during metadata fetch:', error);
            $('#csh-loading-overlay').remove();
            alert('An error occurred while fetching metadata. Please try again.\n\nError: ' + error.message);
            $("#editPage").removeClass("lowOpacity");
            $("#bodyCell").removeClass("changesetloading");
        }
    });
} else {
    // Non-mapped entity types - proceed without metadata
    totalComponentCount = listTableLength;
    startMetadataLoading();
}

// Function to start pagination after metadata is loaded
function startPaginationWithMetadata() {
    // Create progress indicator
    var progressHtml = `
        <style>
            @keyframes csh-indeterminate {
                0% { left: -35%; right: 100%; }
                60% { left: 100%; right: -90%; }
                100% { left: 100%; right: -90%; }
            }
            .csh-progress-indeterminate {
                position: absolute;
                background-color: #0070d2;
                top: 0;
                bottom: 0;
                animation: csh-indeterminate 1.5s cubic-bezier(0.65, 0.815, 0.735, 0.395) infinite;
            }
            .csh-progress-determinate {
                transition: width 0.3s ease;
            }
        </style>
        <div id="csh-pagination-progress" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
             background: white; border: 3px solid #0070d2; border-radius: 8px; padding: 20px; z-index: 10000;
             box-shadow: 0 4px 16px rgba(0,0,0,0.3); min-width: 400px;">
            <h3 style="margin: 0 0 15px 0; color: #0070d2;">Loading Components...</h3>
            <div style="margin-bottom: 10px;">
                <div style="background: #f3f3f3; border-radius: 4px; height: 24px; overflow: hidden; position: relative;">
                    <div id="csh-progress-bar" class="csh-progress-indeterminate"></div>
                </div>
            </div>
            <div id="csh-progress-text" style="margin-bottom: 10px; color: #333;">
                Loaded: <strong>1,000</strong> rows | Current page: <strong>1</strong>
            </div>
            <div id="csh-progress-estimate" style="margin-bottom: 15px; font-size: 12px; color: #666;">
                Calculating...
            </div>
            <button id="csh-cancel-pagination" style="background: #c23934; color: white; border: none;
                    padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                Cancel Loading
            </button>
        </div>
        <div id="csh-pagination-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
             background: rgba(0,0,0,0.5); z-index: 9999;"></div>
    `;
    $('body').append(progressHtml);

    // Add cancel handler
    $('#csh-cancel-pagination').click(function() {
        shouldContinuePagination = false;
        isLoadingMorePages = false; // Mark pagination as complete

        // Finalize the table with rows loaded so far
        if (changeSetTable) {
            totalComponentCount = changeSetTable.rows().count();
            changeSetTable.draw(); // Redraw to show final state
        }

        $('#csh-pagination-progress').remove();
        $('#csh-pagination-overlay').remove();
        $("#editPage").removeClass("lowOpacity");
        $("#bodyCell").removeClass("changesetloading");

        console.log(`Pagination cancelled by user. Table finalized with ${totalComponentCount} rows.`);
    });

    $("#editPage").addClass("lowOpacity");
    $("#bodyCell").addClass("changesetloading");

    // Async recursive function to fetch pages (metadata already loaded!)
    var totalRowsLoaded = 1000;
    var currentPage = 1;
    var startTime = Date.now();
    var tableInitialized = false;

    async function fetchNextPage() {
        // Initialize table with first 1000 rows immediately (metadata already applied!)
        if (!tableInitialized && currentPage === 1) {
            tableInitialized = true;
            totalComponentCount = totalRowsLoaded;
            console.log(`Initializing table with first ${totalRowsLoaded} rows with metadata...`);

            // Setup and create table (metadata already applied to rows)
            setupTable();
            applyMetadataToRows(cachedMetadataResults); // Apply metadata to first 1000 rows
            createDataTable();

            // Update progress to show table is visible
            $('#csh-progress-text').html(
                `<span style="color: #16844c;">✓ Table visible with ${totalRowsLoaded.toLocaleString()} rows</span><br>` +
                `Loading more in background...`
            );
        }

        if (!shouldContinuePagination || listTableLength < 1000) {
            // Done loading all pages - cleanup
            $('#csh-pagination-progress').remove();
            $('#csh-pagination-overlay').remove();

            // Final update
            totalComponentCount = totalRowsLoaded;
            isLoadingMorePages = false;
            console.log(`Pagination complete: ${totalComponentCount} total rows loaded`);

            // Redraw table to show final count
            if (changeSetTable) {
                changeSetTable.draw();
            }

            $("#editPage").removeClass("lowOpacity");
            $("#bodyCell").removeClass("changesetloading");

            return;
        }

        try {
            // Use async AJAX
            const data = await $.ajax({
                url: nextPageHref,
                data: {
                    rowsperpage: 1000,
                    isdtp: 'mn',
                    lsr: nextPageLsr,
                    id: changeSetId,
                    entityType: selectedEntityType
                },
                async: true
            });

            var parsedResponse = $(data);
            var nextTable = parsedResponse.find("table.list tr.dataRow");

            // Add columns to new rows
            if (selectedEntityType in entityTypeMap) {
                addColumnsToRows(nextTable);
            }

            // Add rows to DOM
            nextTable.appendTo("table.list tbody");

            // Apply cached metadata to these new rows
            if (cachedMetadataResults.length > 0) {
                applyMetadataToRows(cachedMetadataResults);
            }

            listTableLength = nextTable.length;
            nextPageLsr = nextPageLsr + listTableLength;
            totalRowsLoaded += listTableLength;
            currentPage++;

            // Add new rows to DataTable
            if (changeSetTable) {
                var newRowNodes = nextTable.toArray();
                changeSetTable.rows.add(newRowNodes);
                changeSetTable.draw(false);
                totalComponentCount = totalRowsLoaded;
            }

                // Calculate time estimates
                var now = Date.now();
                var avgTimePerPage = (now - startTime) / currentPage;

                // Update progress bar - switch to determinate 100% on completion
                if (listTableLength < 1000) {
                    // Completed - switch to determinate mode and show 100%
                    $('#csh-progress-bar')
                        .removeClass('csh-progress-indeterminate')
                        .addClass('csh-progress-determinate')
                        .css('width', '100%');
                }
                // Otherwise, let the indeterminate animation run (don't set width)

                if (tableInitialized) {
                    $('#csh-progress-text').html(
                        `<span style="color: #16844c;">✓ Table visible</span> | ` +
                        `Total: <strong>${totalRowsLoaded.toLocaleString()}</strong> rows | ` +
                        `Page: <strong>${currentPage}</strong>` +
                        (listTableLength < 1000 ? ' | <em>Complete!</em>' : '')
                    );
                } else {
                    $('#csh-progress-text').html(
                        `Loaded: <strong>${totalRowsLoaded.toLocaleString()}</strong> rows | ` +
                        `Current page: <strong>${currentPage}</strong>` +
                        (listTableLength < 1000 ? ' | <em>Last page reached</em>' : '')
                    );
                }

                // Update time estimate
                if (listTableLength >= 1000) {
                    $('#csh-progress-estimate').html(
                        `Average: ${(avgTimePerPage / 1000).toFixed(1)}s per page`
                    );
                } else {
                    $('#csh-progress-estimate').html('Complete!');
                }

                // Continue to next page with a small delay to keep UI responsive
                if (listTableLength >= 1000 && shouldContinuePagination) {
                    setTimeout(fetchNextPage, 50); // Small delay to allow UI updates (reduced since we batch draws)
                } else {
                    // Finished
                    shouldContinuePagination = false;
                    fetchNextPage(); // Call one more time to trigger cleanup
                }

            } catch (error) {
                console.error("Error fetching page:", error);
                alert("Error loading page " + (currentPage + 1) + ". Table will display " + totalRowsLoaded + " rows loaded so far.");
                shouldContinuePagination = false;
                isLoadingMorePages = false; // Mark as complete

                // Finalize table with rows loaded so far
                if (changeSetTable) {
                    totalComponentCount = totalRowsLoaded;
                    changeSetTable.draw();
                }

                fetchNextPage(); // Trigger cleanup
            }
        }

        // Start fetching pages
        fetchNextPage();
}

// Function to initialize table with metadata already loaded (no pagination needed)
function initializeTableWithMetadata() {
    console.log(`Initializing table with ${totalComponentCount} rows with metadata...`);
    setupTable();
    applyMetadataToRows(cachedMetadataResults); // Apply metadata to all rows
    createDataTable();
    $("#editPage").removeClass("lowOpacity");
    $("#bodyCell").removeClass("changesetloading");
}

// Function to start metadata loading after pagination is complete (or skipped)
function startMetadataLoading() {
    if (selectedEntityType in entityTypeMap) {
        setupTable();
        $("#editPage").addClass("lowOpacity");
        $("#bodyCell").addClass("changesetloading");

        chrome.runtime.sendMessage({
            "oauth": "connectToLocal",
            "sessionId": sessionId,
            "serverUrl": serverUrl
        }, function (response) {
            console.log('Fetching metadata once for all components of type:', selectedEntityType);
            getMetaData(processListResults);
        });
    } else {
        // Non-mapped entity types - setup basic table
    typeColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Type')");
    nameColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Name')");


    var changeSetHead2 = $('<thead></thead>').prependTo('table.list').append($('table.list tr:first'));
    if (typeColumn.length > 0) {
        changeSetHead2.after('<tfoot><tr><td></td><td></td><td></td></tr></tfoot>');
    } else {
        changeSetHead2.after('<tfoot><tr><td></td><td></td></tr></tfoot>');
    }

    changeSetTable = $('table.list').DataTable({
            paging: false,
            dom: 'lrti',
            "order": [[1, "asc"]],
            "deferRender": true,  // Performance optimization for large datasets
            initComplete: basicTableInitComplete
        }
    );

    $('<input style="float: left;"  value="Reset Search Filters" class="clearFilters btn" name="Reset Search Filters" title="Reset search filters" type="button" />').prependTo('div.rolodex');
    $('#editPage').append('<input type="hidden" name="rowsperpage" value="1000" /> ');

    var gotoloc2 = "'/" + $("#id").val() + "?tab=PackageComponents&rowsperpage=1000'";
    $('input[name="cancel"]').before('<input value="View change set" class="btn" name="viewall" title="View all items in changeset in new window" type="button" onclick="window.open(' + gotoloc2 + ',\'_blank\');" />');
    }
}



$(document).ready(function () {
    $(".clearFilters").click(clearFilters);
	$( "#logoutLink" ).click(deployLogout);

    $("#editPage").submit(function (event) {
        clearFilters();
        return true;
    });
    $("#compareorg").click(oauthLogin);

    if (!sessionId) {
        $('.bDescription').append('<span style="background-color:yellow"><strong><br/> <br/>Sorry, currently for the Change Set Helper to work, please UNSET the Require HTTPOnly Attribute checkbox in Security -> Session Settings. Then logout and back in again.  </strong></span>')
    }
});

//Find out if they are logged in already
chrome.runtime.sendMessage({'proxyFunction': 'getDeployUsername'}, function(username) {
	console.log(username);
	if (username) {
		//Then there is a logged in deploy user
		$("#compareEnv").hide();
		$("#loggedInUsername").html(username);
		$("#logout").show();
	} else {
		$("#compareEnv").show();
        $("#loggedInUsername").html('');
		$("#logout").hide();
	}
	//do nothing else
});