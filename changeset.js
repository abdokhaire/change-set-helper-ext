var changeSetTable = null;
var typeColumn = null;
var nameColumn = null;
var numCallsInProgress = 0;
var totalComponentCount = 0; // Track total rows loaded for pagination decisions
var isLoadingMorePages = false; // Flag to indicate we're still loading pages in background
var cachedMetadataResults = []; // Store metadata results to reuse during pagination
var dynamicColumns = null; // Store dynamic column configuration based on metadata properties

// Compare functionality column indices (set dynamically after table setup)
var compareColumnIndices = {
    folder: -1,              // Folder column (for folder-based entities)
    lastModifiedDate: -1,    // This org's Last Modified Date
    compareDateMod: -1,      // Compare org's Date Modified
    compareModBy: -1,        // Compare org's Modified By
    fullName: -1             // Full Name (clickable for diff)
};

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
    // Add dynamic columns based on metadata properties
    // Use empty string since applyMetadataToRows() will immediately populate with actual values
    if (dynamicColumns && dynamicColumns.length > 0) {
        for (var i = 0; i < dynamicColumns.length; i++) {
            rows.append("<td></td>"); // Will be populated by applyMetadataToRows
        }
    } else {
        // Fallback to basic columns if metadata not loaded yet (should not happen in normal flow)
        rows.append("<td></td>"); // Full Name
        rows.append("<td></td>"); // Last Modified Date
        rows.append("<td></td>"); // Last Modified By Name
    }

    // Add compare columns (empty initially, populated when compare is clicked)
    rows.append("<td></td>"); // Folder
    rows.append("<td></td>"); // Compare Date Modified
    rows.append("<td></td>"); // Compare Modified By
    rows.append("<td></td>"); // Full Name (for diff)
}

function setupTable() {
    console.log('========================================');
    console.log('setupTable: Starting table setup');

    typeColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Type')");
    nameColumn = $("table.list>tbody>tr.headerRow>th>a:contains('Name')");

    console.log('setupTable: Type column exists:', typeColumn.length > 0);
    console.log('setupTable: Name column exists:', nameColumn.length > 0);

    // Log original header structure
    var originalHeaders = [];
    $("table.list tr.headerRow th, table.list tr.headerRow td").each(function(index) {
        var text = $(this).text().trim();
        var linkText = $(this).find('a').text().trim();
        originalHeaders.push(index + ':' + (linkText || text || 'empty'));
    });
    console.log('Original headers:', originalHeaders.join(' | '));

    // Add header columns dynamically based on metadata properties
    // Note: We don't add an empty Type column when it doesn't exist - we just skip it

    // Add dynamic columns from metadata
    if (dynamicColumns && dynamicColumns.length > 0) {
        console.log('setupTable: Adding', dynamicColumns.length, 'dynamic columns');
        for (var i = 0; i < dynamicColumns.length; i++) {
            $("table.list tr.headerRow").append("<td>" + dynamicColumns[i].headerLabel + "</td>");
            console.log('  - Added column:', dynamicColumns[i].headerLabel);
        }
    } else {
        console.log('setupTable: WARNING - No dynamic columns defined! Using fallback columns.');
        // Fallback to basic columns if metadata not loaded yet
        $("table.list tr.headerRow").append("<td>Full Name</td>");
        $("table.list tr.headerRow").append("<td>Last Modified Date</td>");
        $("table.list tr.headerRow").append("<td>Last Modified By Name</td>");
    }

    // Add compare columns (hidden initially, shown when compare is clicked)
    $("table.list tr.headerRow").append("<td>Folder</td>");  // Hidden, used internally for folder-based entities
    $("table.list tr.headerRow").append("<td class='compareOrgName'>Compare Date Modified</td>");
    $("table.list tr.headerRow").append("<td class='compareOrgName'>Compare Modified By</td>");
    $("table.list tr.headerRow").append("<td>Full Name</td>");  // For diff functionality
    console.log('setupTable: Added 4 compare columns (hidden by default)');

    // Log new header structure
    var newHeaders = [];
    $("table.list tr.headerRow th, table.list tr.headerRow td").each(function(index) {
        var text = $(this).text().trim();
        var linkText = $(this).find('a').text().trim();
        newHeaders.push(index + ':' + (linkText || text || 'empty'));
    });
    console.log('After adding headers:', newHeaders.join(' | '));

    // Add columns only to existing rows (not ALL rows to avoid freeze)
    var existingRows = $("table.list tr.dataRow");
    console.log('setupTable: Found', existingRows.length, 'data rows to update');

    // Log first row BEFORE adding columns
    if (existingRows.length > 0) {
        var firstRowBefore = $(existingRows[0]).find('td').length;
        console.log('First row cell count BEFORE addColumnsToRows:', firstRowBefore);
    }

    addColumnsToRows(existingRows);

    // Log first row AFTER adding columns
    if (existingRows.length > 0) {
        var firstRowAfter = $(existingRows[0]).find('td').length;
        console.log('First row cell count AFTER addColumnsToRows:', firstRowAfter);

        // Log each cell
        var cells = [];
        $(existingRows[0]).find('td').each(function(index) {
            var text = $(this).text().trim();
            cells.push(index + ':' + (text.substring(0, 15) || 'empty'));
        });
        console.log('First row cells:', cells.join(' | '));
    }

    var changeSetHead = $('<thead></thead>').prependTo('table.list').append($('table.list tr:first'));

    // Generate footer with correct number of columns
    var totalColumns = $("table.list thead tr th, table.list thead tr td").length;
    var footerCells = '';
    for (var i = 0; i < totalColumns; i++) {
        footerCells += '<td></td>';
    }
    changeSetHead.after('<tfoot><tr>' + footerCells + '</tr></tfoot>');
    console.log('setupTable: Generated footer with', totalColumns, 'columns');

    console.log('setupTable: Moved header to thead');
    console.log('========================================');

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

// Convert camelCase to Capital Case (e.g., "lastModifiedDate" -> "Last Modified Date")
function camelCaseToCapitalCase(str) {
    // Handle empty or invalid strings
    if (!str || typeof str !== 'string') return str;

    // Insert space before capital letters and capitalize first letter
    var result = str
        .replace(/([A-Z])/g, ' $1')  // Add space before capitals
        .replace(/^./, function(char) { return char.toUpperCase(); })  // Capitalize first letter
        .trim();

    return result;
}

// Check if a value is a Salesforce ID (15 or 18 character alphanumeric string)
function isSalesforceId(value) {
    if (typeof value !== 'string') return false;

    // Salesforce IDs are either 15 or 18 characters, alphanumeric
    var length = value.length;
    if (length !== 15 && length !== 18) return false;

    // Check if it's alphanumeric (Salesforce IDs don't contain special characters)
    return /^[a-zA-Z0-9]+$/.test(value);
}

// Determine which columns to add dynamically based on metadata properties
function determineMetadataColumns(metadataRecord) {
    if (!metadataRecord) {
        console.log('determineMetadataColumns: No metadata record provided');
        return [];
    }

    console.log('========================================');
    console.log('determineMetadataColumns: Analyzing metadata properties');
    console.log('Sample metadata record:', metadataRecord);

    var columns = [];

    // Define which properties to include and in what order
    // Skip certain properties that aren't useful for display
    // fullName is skipped because the table already has a "Name" column
    var skipProperties = ['id', 'type', 'fileName', 'manageableState', 'namespacePrefix', 'fullName'];

    // Preferred order for common properties
    // Note: ID columns (createdById, lastModifiedById) are automatically filtered out
    // Note: fullName is excluded (already have "Name" column in Salesforce table)
    var propertyOrder = [
        'createdDate',
        'createdByName',
        'lastModifiedDate',
        'lastModifiedByName'
    ];

    // First add properties in preferred order if they exist
    for (var i = 0; i < propertyOrder.length; i++) {
        var prop = propertyOrder[i];
        console.log('  - Checking property:', prop, 'exists:', metadataRecord.hasOwnProperty(prop), 'value:', metadataRecord[prop]);

        if (metadataRecord.hasOwnProperty(prop) && metadataRecord[prop] !== undefined) {
            // Skip if the value is a Salesforce ID
            if (isSalesforceId(metadataRecord[prop])) {
                console.log('    → Skipping (Salesforce ID format)');
                continue;
            }

            console.log('    → Adding column:', prop);
            columns.push({
                propertyName: prop,
                headerLabel: camelCaseToCapitalCase(prop),
                isDate: prop.toLowerCase().includes('date')
            });
        } else {
            console.log('    → Property not found or undefined');
        }
    }

    // Then add any remaining properties not already included
    for (var prop in metadataRecord) {
        if (metadataRecord.hasOwnProperty(prop) &&
            skipProperties.indexOf(prop) === -1 &&
            propertyOrder.indexOf(prop) === -1 &&
            metadataRecord[prop] !== undefined) {

            // Skip if the value is a Salesforce ID
            if (isSalesforceId(metadataRecord[prop])) {
                console.log('  - Skipping column', prop, '(Salesforce ID format)');
                continue;
            }

            columns.push({
                propertyName: prop,
                headerLabel: camelCaseToCapitalCase(prop),
                isDate: prop.toLowerCase().includes('date')
            });
        }
    }

    console.log('========================================');
    console.log('FINAL COLUMN LIST (' + columns.length + ' columns):');
    for (var i = 0; i < columns.length; i++) {
        console.log('  ' + i + ': ' + columns[i].propertyName + ' -> "' + columns[i].headerLabel + '" (date: ' + columns[i].isDate + ')');
    }
    console.log('========================================');

    return columns;
}


function processListResults(response) {
    console.log('========================================');
    console.log('processListResults: Received response from JSforce');
    console.log('Response type:', typeof response);
    console.log('Has results:', !!response.results);

    var results = [];
    if (response.results && !Array.isArray(response.results)) {
        results.push(response.results);
        console.log('Single result converted to array');
    } else {
        results = response.results;
        console.log('Results is already array');
    }
    var len = results ? results.length : 0;
    console.log('Processing', len, 'metadata results from JSforce');

    // Log first few results to see data structure
    if (len > 0) {
        console.log('First JSforce result:', results[0]);
        if (len > 1) {
            console.log('Second JSforce result:', results[1]);
        }

        // Determine dynamic columns from first metadata record (only once)
        var isFirstTime = !dynamicColumns;
        if (isFirstTime && results[0]) {
            dynamicColumns = determineMetadataColumns(results[0]);
            console.log('Dynamic columns determined:', dynamicColumns.length, 'columns');

            // Setup table structure with dynamic columns (first time only)
            console.log('Setting up table with dynamic columns...');
            setupTable();
        }
    }

    // Cache metadata results for reuse during pagination
    // Merge new results with cached results (dedupe by id)
    for (i = 0; i < len; i++) {
        var existingIndex = cachedMetadataResults.findIndex(r => r.id === results[i].id);
        if (existingIndex === -1) {
            cachedMetadataResults.push(results[i]);
        }
    }
    console.log('Cached metadata now has', cachedMetadataResults.length, 'total records');

    // Apply metadata to matching rows in the table
    applyMetadataToRows(results);

    numCallsInProgress--;
    console.log('numCallsInProgress:', numCallsInProgress);

    // Only create table if it doesn't exist yet (first time)
    // During progressive loading, table is already created
    if (numCallsInProgress <= 0 && !changeSetTable) {
        console.log('All metadata calls complete - creating DataTable');
        createDataTable();
    }
    console.log('========================================');

}

// Apply metadata to rows in the table
// Uses same hardcoded indices as original version for consistency
function applyMetadataToRows(results) {
    if (!results || results.length === 0) {
        console.log('applyMetadataToRows: No results to apply');
        return;
    }

    console.log('========================================');
    console.log('applyMetadataToRows: Processing', results.length, 'metadata records');

    // Log first metadata record to see structure
    if (results.length > 0) {
        console.log('Sample metadata record:', {
            id: results[0].id,
            fullName: results[0].fullName,
            lastModifiedDate: results[0].lastModifiedDate,
            lastModifiedByName: results[0].lastModifiedByName,
            createdDate: results[0].createdDate,
            createdByName: results[0].createdByName
        });
    }

    // Log table structure
    var sampleRow = $("table.list tr.dataRow").first();
    if (sampleRow.length > 0) {
        var cellCount = sampleRow.find('td').length;
        console.log('Sample row has', cellCount, 'cells');

        // Log each cell content
        var cellContents = [];
        sampleRow.find('td').each(function(index) {
            var text = $(this).text().trim();
            cellContents.push(index + ':' + (text.substring(0, 20) || 'empty'));
        });
        console.log('Sample row cells:', cellContents.join(' | '));
    }

    // Log header structure
    var headers = [];
    $("table.list thead tr th, table.list thead tr td").each(function(index) {
        var text = $(this).text().trim();
        var linkText = $(this).find('a').text().trim();
        headers.push(index + ':' + (linkText || text || 'empty'));
    });
    console.log('Table headers:', headers.join(' | '));

    for (i = 0; i < results.length; i++) {
        // Normalize ID to 15 characters (Salesforce IDs can be 15 or 18 chars)
        // 18-char IDs are just 15-char IDs with a 3-char case-safe suffix
        shortid = results[i].id.substring(0, 15);
        var matchingInput = $("input[value='" + shortid + "']");

        // If not found with 15-char ID, try the full 18-char ID if available
        if (matchingInput.length === 0 && results[i].id.length === 18) {
            matchingInput = $("input[value='" + results[i].id + "']");
        }

        if (matchingInput.length === 0) {
            if (i === 0) console.log('First metadata record: No matching row found for ID:', shortid, 'or', results[i].id);
            continue;
        }

        var row = matchingInput.first().closest('tr');

        // Calculate the starting column index for dynamic columns in row cells
        // Row td cells: Name(0), EmptyType(1), Dynamic columns(2+)
        // Note: Checkbox is in header but not in row td's
        // Calculate base column count based on whether Type column exists
        // Row structure: Name(td-0), [Type(td-1) if exists], Dynamic columns
        var baseColumnCount = typeColumn.length > 0 ? 2 : 1;

        // Log first row update
        if (i === 0) {
            console.log('Updating first row:');
            console.log('  - typeColumn exists:', typeColumn.length > 0);
            console.log('  - Base column count (td cells before dynamic):', baseColumnCount);
            console.log('  - Dynamic columns:', dynamicColumns ? dynamicColumns.length : 0);
            console.log('  - Row has', row.children('td').length, 'total td cells');
        }

        // Store fullName as data attribute on Name column for Compare functionality
        // Name is at td index 0 in the row (checkbox is separate)
        if (results[i].fullName) {
            var nameCell = row.children('td:eq(0)');
            nameCell.attr("data-fullName", results[i].fullName);
            nameCell.addClass("fullNameClass");
            if (i === 0) {
                console.log('  - Stored fullName on Name column (td index 0):', results[i].fullName);
            }
        }

        // Populate dynamic columns with metadata values
        if (dynamicColumns && dynamicColumns.length > 0) {
            for (var colIdx = 0; colIdx < dynamicColumns.length; colIdx++) {
                var column = dynamicColumns[colIdx];
                var cellIndex = baseColumnCount + colIdx;
                var value = results[i][column.propertyName];

                // Log first row details - BEFORE formatting
                if (i === 0) {
                    console.log('  - Column', colIdx, '(' + column.propertyName + '): raw value =', value, ', isDate =', column.isDate);
                }

                // Format the value based on column type
                if (value !== undefined && value !== null) {
                    if (column.isDate) {
                        value = convertDate(new Date(value));
                    }
                } else {
                    value = ''; // Empty for undefined/null values
                }

                var cell = row.children('td:eq(' + cellIndex + ')');
                cell.text(value);

                // Log first row details - AFTER formatting
                if (i === 0) {
                    console.log('    → Writing to cell index', cellIndex, ':', value);
                }
            }
        }

        // Populate compare columns (folder field for folder-based entities)
        // The compare columns are at the end: Folder, Compare Date Mod, Compare Mod By, Full Name
        var compareColumnsStartIndex = baseColumnCount + (dynamicColumns ? dynamicColumns.length : 0);

        // Folder column (for folder-based entities like Reports, Dashboards, etc.)
        if (results[i].folder) {
            var folderCell = row.children('td:eq(' + compareColumnsStartIndex + ')');
            folderCell.text(results[i].folder);
            if (i === 0) {
                console.log('  - Populated folder cell at index', compareColumnsStartIndex, ':', results[i].folder);
            }
        }
    }

    console.log('applyMetadataToRows: Completed updating', results.length, 'rows');
    console.log('========================================');
}

function jq(myid) {
    return "#" + myid.replace(/(:|\.|\[|\]|,)/g, "\\$1");
}

function processCompareResults(results, env) {
    console.log('processCompareResults: Processing', results.length, 'compare results');
    console.log('processCompareResults: Using column indices:', compareColumnIndices);

    // Show compare columns (use dynamic indices)
    changeSetTable.column(compareColumnIndices.folder).visible(true);  // Folder (temporarily shown for processing)
    changeSetTable.column(compareColumnIndices.compareDateMod).visible(true);  // Compare Date Modified
    changeSetTable.column(compareColumnIndices.compareModBy).visible(true);  // Compare Modified By
    changeSetTable.column(compareColumnIndices.fullName).visible(true);  // Full Name for diff

    // Update header labels based on environment
    if (env == 'prod') {
        $('.compareOrgName').text('(Prod/Dev)');
    } else {
        $('.compareOrgName').text('(Sandbox)');
    }

    // Update Full Name column header
    $(changeSetTable.column(compareColumnIndices.fullName).header()).text('Full name (Click for diff)');

    for (i = 0; i < results.length; i++) {
        var fullName = results[i].fullName;
        var matchingInput = $('td[data-fullName = "' + fullName + '"]');

        if (matchingInput.length > 0) {
            var rowIdx = changeSetTable.cell('td[data-fullName = "' + fullName + '"]').index().row;

            dateMod = new Date(results[i].lastModifiedDate);

            // Update compare columns with data from other org (use dynamic indices)
            changeSetTable.cell(rowIdx, compareColumnIndices.compareDateMod).data(convertDate(dateMod));
            changeSetTable.cell(rowIdx, compareColumnIndices.compareModBy).data(results[i].lastModifiedByName);
            changeSetTable.cell(rowIdx, compareColumnIndices.fullName).data('<a href="#">' + fullName + '</a>');

            // Make Full Name cell clickable for diff
            var fullNameCell = changeSetTable.cell(rowIdx, compareColumnIndices.fullName).node();
            $(fullNameCell).off("click");
            $(fullNameCell).click(getContents);

            // Compare dates and highlight if this org is newer than other org
            if (compareColumnIndices.lastModifiedDate >= 0) {
                var thisOrgDateMod = changeSetTable.cell(rowIdx, compareColumnIndices.lastModifiedDate).data();
                if (moment(dateMod).diff(convertToMoment(thisOrgDateMod)) < 0) {
                    // Other org is older, so this org is newer - highlight in green
                    changeSetTable.cell(rowIdx, compareColumnIndices.lastModifiedDate).node().style.color = "green";
                }
            }
        }
    }

    // Hide folder column after processing
    changeSetTable.column(compareColumnIndices.folder).visible(false);

    // Populate Compare Modified By dropdown filter
    var column = changeSetTable.column(compareColumnIndices.compareModBy);
    var select = $(column.footer()).find('select');

    select.find('option')
        .remove()
        .end()
        .append('<option value=""></option>');

    column.data().unique().sort().each(function (d) {
        select.append('<option value="' + d + '">' + d + '</option>')
    });

    $("#editPage").removeClass("lowOpacity");
    $("#bodyCell").removeClass("changesetloading");

    console.log('processCompareResults: Completed');
}

function createDataTable() {
    // Prevent double initialization
    var tableSelector = 'div.bPageBlock > div.pbBody > table.list';
    if ($.fn.DataTable.isDataTable(tableSelector)) {
        console.log('createDataTable: Table already initialized, getting existing instance');
        changeSetTable = $(tableSelector).DataTable(); // Get existing instance

        // Filters should already exist from first init via initComplete callback
        // If they're missing, log a warning (shouldn't happen)
        if ($('.dtsearch').length === 0) {
            console.log('createDataTable: WARNING - Filters are missing (this should not happen)');
        }

        // Ensure clear filters button exists
        if ($('.clearFilters').length === 0) {
            console.log('createDataTable: Adding Clear Filters button');
            $('<input style="float: left;"  value="Reset Search Filters" class="clearFilters btn" name="Reset Search Filters" title="Reset search filters" type="button" />').prependTo('div.rolodex');
            $(".clearFilters").click(clearFilters);
        }

        return;
    }

    console.log('createDataTable: Initializing DataTable for the first time');

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

    // Build dynamic column configuration
    // Salesforce header includes checkbox column, so DataTables needs to know about it
    // Header structure depends on whether Type column exists:
    // - If Type exists: Checkbox(0), Name(1), Type(2), Dynamic columns(3+)
    // - If Type doesn't exist: Checkbox(0), Name(1), Dynamic columns(2+)
    var columnConfig = [
        {"searchable": false, "orderable": false, "targets": 0}, //0: checkbox (in header but not in row tds)
        null, //1: name
    ];

    // Add Type column to config only if it exists in the DOM
    if (typeColumn.length > 0) {
        columnConfig.push(null); //2: type
    }

    // Calculate base column count for dynamic column indices
    var baseColumnCount = typeColumn.length > 0 ? 3 : 2; // checkbox, name, [optional type]

    // Find the column to order by (default to first date column)
    var orderByColumnIndex = baseColumnCount; // Default to first dynamic column

    // Add dynamic columns
    if (dynamicColumns && dynamicColumns.length > 0) {
        console.log('createDataTable: Building column config for', dynamicColumns.length, 'dynamic columns');
        for (var i = 0; i < dynamicColumns.length; i++) {
            var colConfig = {};

            // Mark date columns for proper sorting
            if (dynamicColumns[i].isDate) {
                colConfig.type = "date";
                // Use lastModifiedDate for default ordering
                if (dynamicColumns[i].propertyName === 'lastModifiedDate' && orderByColumnIndex === baseColumnCount) {
                    orderByColumnIndex = baseColumnCount + i; // Base columns + dynamic column index
                    // Store the index for compare functionality
                    compareColumnIndices.lastModifiedDate = baseColumnCount + i;
                }
            }

            columnConfig.push(colConfig);
            console.log('  - Column', (baseColumnCount + i), ':', dynamicColumns[i].propertyName, colConfig);
        }
    } else {
        console.log('createDataTable: WARNING - No dynamic columns, using default column config');
        // Fallback for basic columns
        columnConfig.push(null); // Full Name
        columnConfig.push({"type": "date"}); // Last Modified Date
        compareColumnIndices.lastModifiedDate = baseColumnCount + 1;
        columnConfig.push(null); // Last Modified By Name
    }

    // Add compare columns (hidden initially)
    var compareStartIndex = columnConfig.length;
    compareColumnIndices.folder = compareStartIndex;
    compareColumnIndices.compareDateMod = compareStartIndex + 1;
    compareColumnIndices.compareModBy = compareStartIndex + 2;
    compareColumnIndices.fullName = compareStartIndex + 3;

    columnConfig.push({"visible": false}); // Folder (hidden, used internally)
    columnConfig.push({"visible": false, "type": "date"}); // Compare Date Modified (hidden initially)
    columnConfig.push({"visible": false}); // Compare Modified By (hidden initially)
    columnConfig.push({"visible": false}); // Full Name for diff (hidden initially)

    console.log('createDataTable: Added compare columns at indices:', compareColumnIndices);
    console.log('createDataTable: Total columns:', columnConfig.length, ', Order by column:', orderByColumnIndex);

    //Create the datatable
    try {
        changeSetTable = $(tableSelector).DataTable({
            processing: true,
            paging: enablePaging,
            pageLength: 100,  // Show 100 rows per page when pagination is enabled
            dom: domLayout,
            "order": [[orderByColumnIndex, "desc"]], // Order by lastModifiedDate if available
            "deferRender": true,  // Performance optimization for large datasets
            "columns": columnConfig,
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
    // Calculate the starting index for dynamic columns based on whether Type exists
    // Column structure: Checkbox(0), Name(1), [Type(2) if exists], Dynamic columns
    var dynamicColumnsStartIndex = typeColumn.length > 0 ? 3 : 2;

    this.api().columns().every(function () {
        var column = this;
        var colIndex = column.index();

        // Determine if this column should have a filter
        var shouldAddFilter = false;
        var useTextSearch = false;
        var useDropdown = false;

        // Column 0: Checkbox - skip
        if (colIndex === 0) {
            return;
        }
        // Column 1: Name - text search
        else if (colIndex === 1) {
            shouldAddFilter = true;
            useTextSearch = true;
        }
        // Column 2: Type - dropdown (only if Type column exists)
        else if (colIndex === 2 && typeColumn.length > 0) {
            shouldAddFilter = true;
            useDropdown = true;
        }
        // Dynamic columns (starting at 2 or 3 depending on Type)
        else if (colIndex >= dynamicColumnsStartIndex && dynamicColumns) {
            var dynamicColIndex = colIndex - dynamicColumnsStartIndex; // Subtract base columns
            if (dynamicColIndex < dynamicColumns.length) {
                shouldAddFilter = true;
                var colDef = dynamicColumns[dynamicColIndex];

                // Date columns get text search, others get dropdown
                if (colDef.isDate) {
                    useTextSearch = true;
                } else {
                    useDropdown = true;
                }
            }
        }
        // Compare columns (added after dynamic columns, hidden initially)
        else if (colIndex === compareColumnIndices.folder) {
            // Folder column - no filter needed
            return;
        }
        else if (colIndex === compareColumnIndices.compareDateMod) {
            // Compare Date Modified - text search
            shouldAddFilter = true;
            useTextSearch = true;
        }
        else if (colIndex === compareColumnIndices.compareModBy) {
            // Compare Modified By - dropdown
            shouldAddFilter = true;
            useDropdown = true;
        }
        else if (colIndex === compareColumnIndices.fullName) {
            // Full Name - text search
            shouldAddFilter = true;
            useTextSearch = true;
        }

        // Add dropdown filter
        if (shouldAddFilter && useDropdown) {
            var select = $('<select class="dtsearch" ><option value=""></option></select>')
                .appendTo($(column.footer()))
                .on('change', function () {
                    var val = $.fn.dataTable.util.escapeRegex(
                        $(this).val()
                    );

                    column
                        .search(val ? '^' + val + '$' : '', true, false)
                        .draw();
                });

            column.data().unique().sort().each(function (d, j) {
                select.append('<option value="' + d + '">' + d + '</option>')
            });
        }

        // Add text search box
        if (shouldAddFilter && useTextSearch) {
            var searchbox = $('<input class="dtsearch" type="text" placeholder="Search" />')
                .appendTo($(column.footer()))
                .on('keyup change', function () {
                    column
                        .search($(this).val())
                        .draw();
                });
        }
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
    console.log('oauthLogin');
    chrome.runtime.sendMessage({'oauth': "connectToDeploy", environment: env}, function (response) {
        console.log(response);
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

// Clear cached metadata and dynamic columns for fresh load
cachedMetadataResults = [];
dynamicColumns = null; // Reset so next entity type can determine its own columns

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

            // Use shared initialization function
            console.log(`Initializing table with first ${totalRowsLoaded} rows with metadata (pagination in progress)...`);
            doTableInitialization();

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

// Shared function to initialize table with metadata
function doTableInitialization() {
    // setupTable() is now called from processListResults when dynamic columns are first determined
    // So we don't call it here - it's already been called
    // Just apply metadata and create DataTable
    applyMetadataToRows(cachedMetadataResults);

    // Only create table if it doesn't exist yet (prevent double initialization)
    if (!changeSetTable) {
        createDataTable();
    } else {
        console.log('DataTable already initialized, skipping createDataTable()');
    }
}

// Function to initialize table with metadata already loaded (no pagination needed)
function initializeTableWithMetadata() {
    console.log(`Initializing table with ${totalComponentCount} rows with metadata (no pagination)...`);
    doTableInitialization();
    $("#editPage").removeClass("lowOpacity");
    $("#bodyCell").removeClass("changesetloading");
}

// Function to start metadata loading after pagination is complete (or skipped)
function startMetadataLoading() {
    if (selectedEntityType in entityTypeMap) {
        // Don't call setupTable yet - wait until first metadata batch returns
        // so we can determine dynamic columns from the metadata properties
        $("#editPage").addClass("lowOpacity");
        $("#bodyCell").addClass("changesetloading");

        chrome.runtime.sendMessage({
            "oauth": "connectToLocal",
            "sessionId": sessionId,
            "serverUrl": serverUrl
        }, function (response) {
            console.log('Fetching metadata to determine table columns for type:', selectedEntityType);
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
    $(".clearFilters").on('click', clearFilters);
	$( "#logoutLink" ).on('click', deployLogout);

    $("#editPage").on('submit', function (event) {
        clearFilters();
        return true;
    });

    $('input[name="cancel"]').parent().on('click','#compareorg' , oauthLogin);

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