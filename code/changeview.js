$(".apexp").first().before("<p>NOTE: You are in the package view page. You can use this to View and Remove items. Return to the Change Set page to Add or Upload. </p>");

var changeSetHead = $('<thead></thead>').prependTo('table.list').append($('table.list tr:first'));
changeSetHead.after('<tfoot><tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tfoot>');

	
	
//Create the datatable
var changeSetTable = $('table.list').DataTable( {
	 paging: false,
	 dom: 'lrti',
	 "order": [[ 2, "asc" ]],
   "columns": [
		{ "searchable": false, "orderable": false }, //checkbox
		{ "searchable": false, "orderable": false }, //blank box
		null, //name
		null, //parent object
		null, //type
		{"visible": false}, //included by
		{"visible": false} //owned by
	  ],
	 
	 
	 initComplete: function () {
		this.api().columns().every( function () {
			var column = this;
			//Add select search dropdowns
			if ((column.index() == 3) || column.index() == (4)) {
				var select = $('<select><option value=""></option></select>')
					.appendTo( $(column.footer()) )
					.on( 'change', function () {
						var val = $.fn.dataTable.util.escapeRegex(
							$(this).val()
						);
 
						column
							.search( val ? '^'+val+'$' : '', true, false )
							.draw();
					} )
 
				column.data().unique().sort().each( function ( d, j ) {
					select.append( '<option value="'+d+'">'+d+'</option>' )
				} );
			};
			
			//add text search boxes
			if ((column.index() == 2) ) {
				
				var searchbox = $( '<input type="text" placeholder="Search" />' )
					.appendTo( $(column.footer()) )
					.on( 'keyup change', function () {
							column
								.search($(this).val() )
								.draw();									 
					});
				
			}; 
		});
	 }
	 
});