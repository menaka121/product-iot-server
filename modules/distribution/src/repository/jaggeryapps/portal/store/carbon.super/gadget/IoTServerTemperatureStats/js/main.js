var datasource, type, columns, filter, maxUpdateValue, paramsToFilterBy;

var REFRESH_INTERVAL = 5000;

//this needs to be loaded from an autogenerated
datasource = gadgetConfig.datasource;
filter = gadgetConfig.filter;
type = gadgetConfig.type;
maxUpdateValue = gadgetConfig.maxUpdateValue;
columns = gadgetConfig.columns;
paramsToFilterBy = gadgetConfig.params;

var counter = 0;
var TYPE_GET_BY_RANGE = 8;
var TYPE_SEARCH = 13;
var TYPE_SEARCH_COUNT = 14;

var TIME_FROM_STRING = "timeFrom";
var TIME_TO_STRING = "timeTo";
var UNIX_TIME_MAX_VALUE = "9007199254740992";
var UNIX_TIME_MIN_VALUE = "-9007199254740992";
var META_TAG = "meta_";
var initialConfig, urlQueryParams, queryParamValPair, queryString;
var dataTable, chart;

executeDataFetchForGadget();

/**
 * The main execution logic of the gadget is implemented in this function.
 */
function executeDataFetchForGadget() {
	var urlQueryString;

	// fetch all queryParams from the URL.
	urlQueryParams = getAllQueryParamsFromURL();

	// check if params config exists in the gadgetConf.
	if (typeof paramsToFilterBy != "undefined" && paramsToFilterBy.length != 0) {

		if (urlQueryParams != null) {
			// get the values corresponding to the query "params" given in the gadgetConf
			queryParamValPair = getValuesOfQueryFilter();

			// if at-least one of the given params in the conf are missing from the URL params then returns null.
			if (queryParamValPair == null) {
				console.log("Incomplete set of Query Params were found in the URL.");
				return;
			}

			// construct the Lucene query string based on the params given in the gadget-conf
			// and the values parsed from the URL Query String.
			queryString = constructQueryString();

			switch (type) {
				case "realtime":
					urlQueryString = decodeURIComponent(window.top.location.search.substring(1));
					//subscribe to websocket
					subscribe(
						datasource.split(":")[0], datasource.split(":")[1], '10', gadgetConfig.domain,
						onRealTimeEventSuccessRecieval, onRealTimeEventErrorRecieval,
						location.hostname, location.port, 'WEBSOCKET', "SECURED", urlQueryString);
					break;

				case "batch":
					//load data immediately
					fetchDataOnQuery(fetchDataWithCount);
					// then start periodic polling
					setInterval(function () {
						fetchDataOnQuery(fetchDataWithCount);
					}, REFRESH_INTERVAL);
					break;
			}

		} else {
			// if there are NO queryParams in the URL then exit.
			console.log("No Query Params were found in the URL to match the given filter-parameters.");
		}
	} else {
		// if no params to filter by are given in the gadget-conf, then fetch all info available
		// based on date range(if given).
		switch (type) {
			case "realtime":
				urlQueryString = decodeURIComponent(window.top.location.search.substring(1));
				//subscribe to websocket
				subscribe(datasource.split(":")[0], datasource.split(":")[1], '10', gadgetConfig.domain,
					onRealTimeEventSuccessRecieval, onRealTimeEventErrorRecieval, location.hostname, location.port,
					'WEBSOCKET', "SECURED", urlQueryString);
				break;

			case "batch":
				//load data immediately
				fetchDataWithoutQuery(drawBatchChart);

				// then start periodic polling
				setInterval(function () {
					fetchDataWithoutQuery(drawBatchChart);
				}, REFRESH_INTERVAL);
				break;
		}
	}
}

/**
 * Reads the page's URL Query-Params and returns them as an associative array.
 * @returns {*} an associative array containing the URL QueryParams and corresponding values.
 *                If no such Query-Params exists then returns null.
 */
function getAllQueryParamsFromURL() {
	var queryParamList = [], qParam;
	var urlQueryString = decodeURIComponent(window.top.location.search.substring(1));
	if (urlQueryString) {
		var queryStringPairs = urlQueryString.split('&');
		for (var i = 0; i < queryStringPairs.length; i++) {
			qParam = queryStringPairs[i].split('=');
			queryParamList[qParam[0]] = qParam[1];
		}
		return queryParamList;
	} else {
		return null;
	}
}

/**
 * Retrieves the values from the URL-QueryString corresponding to the given QueryParams in the gadget-conf file.
 * The parameters "timeTo" & "timeFrom" (if found in the query string) are added to the returned object regardless
 * of whether they are listed in the gadget-conf.
 * @returns {*} an associative array of the given params in the conf and corresponding value fetched from the
 * 				URL string.
 */
function getValuesOfQueryFilter() {
	var queryValues = [];

	if (TIME_FROM_STRING in urlQueryParams) {
		queryValues[TIME_FROM_STRING] = urlQueryParams[TIME_FROM_STRING];
	}

	if (TIME_TO_STRING in urlQueryParams) {
		queryValues[TIME_TO_STRING] = urlQueryParams[TIME_TO_STRING];
	}

	for (var i = 0; i < paramsToFilterBy.length; i++) {
		var queryV = urlQueryParams[paramsToFilterBy[i]];

		// if atleast one of the queryParams given in the gadgetConf is missing then return "null".
		if (typeof queryV != "undefined" && queryV != null && queryV != "") {
			queryValues[paramsToFilterBy[i]] = queryV;
		} else {
			return null;
		}
	}
	return queryValues;
}

/**
 * Constructs the Lucene Query String to be sent to DAS API.
 * @returns {string} a fully constructed query string from the params given in gadget-conf and
 *                    the query string of the URL.
 */
function constructQueryString() {
	var queryString = "'";
	for (var a = 0; a < paramsToFilterBy.length; a++) {
		if (queryString.length == 1) {
			queryString += META_TAG + paramsToFilterBy[a] + ":" + queryParamValPair[paramsToFilterBy[a]];
		} else {
			queryString += " AND " + META_TAG + paramsToFilterBy[a] + ":" + queryParamValPair[paramsToFilterBy[a]];
		}
	}

	if (TIME_FROM_STRING in queryParamValPair && TIME_TO_STRING in queryParamValPair) {
		// both ends of the time-range (From What Date - To What Date) is given
		queryString += " AND " + META_TAG + "time:" +
			"[" + queryParamValPair[TIME_FROM_STRING] + " TO " + queryParamValPair[TIME_TO_STRING] + "]";

	} else if (TIME_FROM_STRING in queryParamValPair && !(TIME_TO_STRING in queryParamValPair)) {
		// Only the start of the time-range (From What Date) is given
		queryString += " AND " + META_TAG + "time:" +
			"[" + queryParamValPair[TIME_FROM_STRING] + " TO " + UNIX_TIME_MAX_VALUE + "]";

	} else if (!(TIME_FROM_STRING in queryParamValPair) && TIME_TO_STRING in queryParamValPair) {
		// Only the end of the time-range (To What Date) is given
		queryString += " AND " + META_TAG + "time:" +
			"[" + UNIX_TIME_MIN_VALUE + " TO " + queryParamValPair[TIME_TO_STRING] + "]";
	}
	//queryString += " AND meta_time:[1456467843079 TO 1456468494817]'";
	queryString += "'";
	return queryString;
}

/**
 * Utility method to fetch columns of the datasource provided for a Batch-Type Gadget.
 * @param table the name of the datasource table whose columns needs to be extracted.
 */
function getColumns(table) {
	console.log("Fetching table schema for table: " + table);
	var url = "/portal/apis/analytics?type=10&tableName=" + table;
	$.getJSON(url, function (data) {
		if (data) {
			columns = parseColumns(JSON.parse(data.message));
		}

	});
}

/** Constructs an associative array containing the columns and the corresponding data-type ("String", "Long", etc)
 * 	from the returned object as a result of the "getColumns" method above.
 * @param data the response object returned from the "getColumns(table)" call to the DAS API.
 * @returns {Array|*} an array containing the column names as keys and their type as values.
 */
function parseColumns(data) {
	if (data.columns) {
		var keys = Object.getOwnPropertyNames(data.columns);
		columns = keys.map(function (key, i) {
			return column = {
				name: key,
				type: data.columns[key].type
			};
		});
		return columns;
	}
}

/**
 * Makes the initial call to the DAS APIs to get the count of all matching indexes based on a given query.
 * Upon receiving a response (count), a subsequent method is called to fetch the given "count" amount of data from
 * DAS that matches the query.
 * @param callback the subsequent method to be called using the "count" response value received from the API call.
 */
function fetchDataOnQuery(callback) {
	var request = {
		type: TYPE_SEARCH_COUNT,		// DAS API type corresponding to fetching data-count for "query"
		tableName: datasource,
		query: queryString
	};
	$.ajax({
		url: "/portal/apis/analytics",
		method: "GET",
		data: request,
		contentType: "application/json",
		success: function (data) {
			if (callback != null) {
				callback(drawBatchChart, data.message);
			}
		}
	});
}

/**
 * Makes an API call to the DAS to fetch the "count" number of data matching the queryString constructed from the
 * query-string and the param-list provided in the gadget-conf. The fetched data are passed into the provided
 * "callback" method which further processes and draws the chart against this data.
 * @param callback the method to which the fetched data are to be passed in for further processing.
 * @param totalCount the count of all matching data available against the queryString.
 */
function fetchDataWithCount(callback, totalCount) {
	var timeFrom = "undefined";
	var timeTo = "undefined";
	var request = {
		type: TYPE_SEARCH,				// DAS API type corresponding to fetching data for "query"
		tableName: datasource,
		filter: filter,
		query: queryString,
		timeFrom: timeFrom,
		timeTo: timeTo,
		start: 0,
		count: totalCount
	};
	$.ajax({
		url: "/portal/apis/analytics",
		method: "GET",
		data: request,
		contentType: "application/json",
		success: function (data) {
			if (callback != null) {
				var sortedData = sortData(data.message);
				callback(makeRows(sortedData));
			}
		}
	});
}

/**
 * Retrieves all data available in a datasource irrespective of any query filters. However, the API call incorporates
 * a data range to be submitted whilst fetching this info. If such date range related query strings
 * ("timeFrom" or "timeTo") are found in the URL, then they are used.
 * @param callback the method to which the fetched data are to be passed in for further processing.
 */
function fetchDataWithoutQuery(callback) {
	var timeFrom = "undefined";
	var timeTo = "undefined";

	if (urlQueryParams != null) {
		if (TIME_FROM_STRING in urlQueryParams) {
			timeFrom = urlQueryParams[TIME_FROM_STRING];
		}

		if (TIME_TO_STRING in urlQueryParams) {
			timeTo = urlQueryParams[TIME_TO_STRING];
		}
	}

	var request = {
		type: TYPE_GET_BY_RANGE,	// DAS API type corresponding to fetching data by date range.
		tableName: datasource,
		timeFrom: timeFrom,
		timeTo: timeTo,
		start: 0
	};
	$.ajax({
		url: "/portal/apis/analytics",
		method: "GET",
		data: request,
		contentType: "application/json",
		success: function (data) {
			if (callback != null) {
				callback(makeRows(JSON.parse(data.message)));
			}
		}
	});
}

/**
 * This is a utility method to convert Unix-Timestamp values to Epoch Time
 * @param unix_timestamp the unix time to be converted
 * @returns {string} the formatted epoch-time of the given unix-timestamp
 */
function convertToEpoch(unix_timestamp) {
	// Create a new JavaScript Date object based on the timestamp
	// multiplied by 1000 so that the argument is in milliseconds, not seconds.
	var date = new Date(unix_timestamp * 1000);
	// Hours part from the timestamp
	var hours = date.getHours();
	// Minutes part from the timestamp
	var minutes = "0" + date.getMinutes();
	// Seconds part from the timestamp
	var seconds = "0" + date.getSeconds();

	var thisDate = date.getDate();
	var thisMonth = date.getMonth();
	var thisYear = date.getUTCFullYear();

	var formattedTime = hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);

	// Will display time in 10:30:23 format
	return (formattedTime);
}

/**
 * Sorts the given data array according to the values of its "timestamp" key.
 * @param payload a JSON string with multiple data-arrays having a "timestamp" key-value pair.
 * @returns {*} JSON Object with multiple sorted by "timestamp"
 */
function sortData(payload) {
	var dataFromDAS = JSON.parse(payload);
	sortedData = dataFromDAS.sort(function (a, b) {
		return a.timestamp - b.timestamp;
	});
	return sortedData;
}

/**
 * Fetches the values corresponding to the keys in the "columns" (either provided in the gadget-conf or fetched via the
 * "getColumns(table)" method) array from the data object passed in.
 * @param data a JSON Object containing multiple data values fetched from the datasource with column-name:value pairs.
 * @returns {Array} an array with objects that contain the columns from the fetched "columns" and their corresponding
 * 					values.
 */
function makeRows(data) {
	var rows = [];
	for (var i = 0; i < data.length; i++) {
		var record = data[i];
		var keys = Object.getOwnPropertyNames(record.values);
		keys.push();

		var row = columns.map(function (column, i) {
			var colName = column.name;
			var recordVal = record.values[colName];

			if (typeof recordVal == 'undefined') {
				if (column.name.toUpperCase() === "TIMESTAMP" && (record.timestamp || record.TIMESTAMP)) {
					recordVal = record.timestamp;
				} else {
					recordVal = record.values[META_TAG + colName];
				}
			}
			return recordVal;
		});
		rows.push(row);
	}
	return rows;
}

function makeDataTable(data) {
	var dataTable = new igviz.DataTable();
	if (columns.length > 0) {
		columns.forEach(function (column, i) {
			var type = "N";
			if (column.type == "STRING" || column.type == "string") {
				type = "C";
			} else if (column.type == "TIME" || column.type == "time") {
				type = "T";
			}
			dataTable.addColumn(column.name, type);
		});
	}
	data.forEach(function (row, index) {
		for (var i = 0; i < row.length; i++) {
			if (dataTable.metadata.types[i] == "N") {
				data[index][i] = parseInt(data[index][i]);
			}
		}
	});
	dataTable.addRows(data);
	return dataTable;
}

function drawChart(data) {
	var dataTable = makeDataTable(data);
	gadgetConfig.chartConfig.width = $("#placeholder").width();
	gadgetConfig.chartConfig.height = $("#placeholder").height() - 65;
	var chartType = gadgetConfig.chartConfig.chartType;
	var xAxis = gadgetConfig.chartConfig.xAxis;
	jQuery("#noChart").html("");
	if (chartType === "bar" && dataTable.metadata.types[xAxis] === "N") {
		dataTable.metadata.types[xAxis] = "C";
	}

	if (gadgetConfig.chartConfig.chartType === "table" || gadgetConfig.chartConfig.chartType === "singleNumber") {
		gadgetConfig.chartConfig.height = $("#placeholder").height();
		chart = igviz.draw("#placeholder", gadgetConfig.chartConfig, dataTable);
		chart.plot(dataTable.data);

	} else {
		chart = igviz.setUp("#placeholder", gadgetConfig.chartConfig, dataTable);
		chart.setXAxis({
				"labelAngle": -35,
				"labelAlign": "right",
				"labelDy": 0,
				"labelDx": 0,
				"titleDy": 25
			})
			.setYAxis({
				"titleDy": -30
			});
		chart.plot(dataTable.data);
	}
}


//stuff required for realtime charting
function onRealTimeEventSuccessRecieval(streamId, data) {
	drawRealtimeChart(data);
}

function onRealTimeEventErrorRecieval(dataError) {
	console.log("Error occurred " + dataError);
}

/**
 * Draws the real-time chart based on the values in the data object passed in.
 * @param data an object containing all the column:value pair data
 */
function drawRealtimeChart(data) {
	if (chart == null) {
		jQuery("#noChart").html("");
		gadgetConfig.chartConfig.width = $("#placeholder").width() - 110;
		gadgetConfig.chartConfig.height = $("#placeholder").height() - 40;

		if (gadgetConfig.chartConfig.charts[0].type == "map") {
			var mapType = gadgetConfig.chartConfig.charts[0].mapType;

			if (mapType == "world") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/countryInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/world/';
			} else if (mapType == "usa") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/usaInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/usa/';
			} else if (mapType == "europe") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/countryInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/europe/';
			}
		}

		chart = new vizg(createDataTable(convertData(data)), gadgetConfig.chartConfig);
		chart.draw("#placeholder");
	} else {
		chart.insert(convertData(data));
	}
}

/**
 * Draws the batch-chart based on the values in the data object passed in.
 * @param data an object containing all the column:value pair data
 */
function drawBatchChart(data) {
	if (chart == null) {
		jQuery("#noChart").html("");
		gadgetConfig.chartConfig.width = $("#placeholder").width() - 110;
		gadgetConfig.chartConfig.height = $("#placeholder").height() - 40;

		if (gadgetConfig.chartConfig.charts[0].type == "map") {
			var mapType = gadgetConfig.chartConfig.charts[0].mapType;

			if (mapType == "world") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/countryInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/world/';
			} else if (mapType == "usa") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/usaInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/usa/';
			} else if (mapType == "europe") {
				gadgetConfig.chartConfig.helperUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/countryInfo/';
				gadgetConfig.chartConfig.geoCodesUrl = document.location.protocol + "//" + document.location.host + '/portal/geojson/europe/';
			}
		}

		initialConfig = JSON.parse(JSON.stringify(gadgetConfig.chartConfig));

	} else {
		gadgetConfig.chartConfig = initialConfig;
		initialConfig = JSON.parse(JSON.stringify(gadgetConfig.chartConfig));
	}

	chart = new vizg(createDataTable(convertData(data)), gadgetConfig.chartConfig);
	chart.draw("#placeholder");
}


function convertData(data) {
	for (var i = 0; i < data.length; i++) {
		for (var x = 0; x < data[i].length; x++) {
			var type = gadgetConfig.columns[x]["type"].toUpperCase();
			if (type != "STRING" && type != "BOOLEAN") {
				data[i][x] = parseFloat(data[i][x]);
			}
		}
	}
	return data;
}

function createDataTable(data) {
	var names = [];
	var types = [];

	for (var i = 0; i < gadgetConfig.columns.length; i++) {
		var name = gadgetConfig.columns[i]["name"];
		names.push(name);
		var type = columns[i]["type"].toUpperCase();

		if (type === "INT" || type === "INTEGER" || type === "FLOAT" || type === "DOUBLE") {
			type = "linear";
		} else if (gadgetConfig.columns[i]["type"].toUpperCase() == "TIME" || name.toUpperCase() == "TIME") {
			type = "time";
		} else {
			type = "ordinal";
		}
		types.push(type);
	}

	datatable = [
		{
			"metadata": {
				"names": names,
				"types": types
			},
			"data": data
		}
	];
	return datatable;
}