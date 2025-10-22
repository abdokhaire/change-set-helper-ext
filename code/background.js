var CSH_APIVERSION = "48.0";
const versionPattern = RegExp('^[0-9][0-9]\.0$')


chrome.storage.sync.get([
    'salesforceApiVersion'
], function(items) {
    if (items.salesforceApiVersion) {
        // APIVERSION = items.salesforceApiVersion;
        CSH_APIVERSION = versionPattern.test(items.salesforceApiVersion) ? items.salesforceApiVersion : '48.0';
        console.log(CSH_APIVERSION);
    };
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    //console.log(JSON.stringify(changes, null, 2));

    if (changes.salesforceApiVersion) {
        CSH_APIVERSION = versionPattern.test(changes.salesforceApiVersion.newValue) ? changes.salesforceApiVersion.newValue : '48.0';
        console.log(CSH_APIVERSION);
    };
});

const POLLTIMEOUT = 20*60*1000; // 20 minutes
const POLLINTERVAL = 5000; //5 seconds

var client_id = '3MVG97quAmFZJfVzlPO9kMeS90FBVJuF7x_gWYYRdhK9UAMWuk9WVaCMTqKAUEf2u4ge.OhGG_2vYl.EO3e.i';

var connDeploy = {conn:null, username:null };
var connLocal = {conn: null, username:null };
var connLocalOauth = {conn:null, username:null };

var redirectUri = chrome.identity.getRedirectURL("sfdc");

var sandbox_auth_url = "https://test.salesforce.com/services/oauth2/authorize?display=page&prompt=select_account&response_type=token&client_id=" + client_id + "&redirect_uri=" + redirectUri;
var prod_auth_url = "https://login.salesforce.com/services/oauth2/authorize?display=page&response_type=token&prompt=select_account&client_id=" + client_id + "&redirect_uri=" + redirectUri;

chrome.runtime.onConnect.addListener(function (port) {
    if (port.name == "deployHandler") {
        port.onMessage.addListener(function (request) {
            if (request.proxyFunction == "deploy")
                deploy(port, request.opts, request.changename, request.sessionId, request.serverUrl);
        });
    }

    if (port.name == "quickDeployHandler") {
        port.onMessage.addListener(function (request) {
            if (request.proxyFunction == "quickDeploy")
                quickDeploy(port, request.currentId);
        });
    }
})


chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        if (request.oauth == "request") {
            getSfdcOauth2(sendResponse, request.environment);
            return true;
        }

        if (request.proxyFunction == "downloadLocalMetadata") {
            downloadLocalMetadata(sendResponse, request.changename);
            return true;
        }

        if (request.proxyFunction == "getDeployUsername") {
            sendResponse(connDeploy.username);
            return true;
        }

        if (request.proxyFunction == "listDeployMetaData") {
            connDeploy.conn.metadata.list(request.proxydata, CSH_APIVERSION, function (err, results) {
                if (err) {
                    console.error(err);
                }
                sendResponse({'err': err, 'results':results});
            }
            );
            return true;
        }

        if (request.proxyFunction == "listLocalMetaData") {
            connLocal.conn.metadata.list(request.proxydata, CSH_APIVERSION, function (err, results) {
                if (err) {
                    console.error(err);
                }
                sendResponse({'err': err, 'results':results});
            }
            );
            return true;
        }

        if (request.proxyFunction == "compareContents") {
            var type = request.entityType;
            var item = request.itemName;
            compareContents(type, item);
            return false;
        }

        if (request.oauth == "connectToDeploy") {
            connectToDeploy(sendResponse, request.environment);
            return true;
        }

        if (request.oauth == "connectToLocal") {
            setLocalConn(sendResponse, request.sessionId, request.serverUrl);
            return true;
        }

        if (request.oauth == "connectToLocalOauth") {
            connectToLocalOauth(sendResponse);
            return true;
        }


        if (request.oauth == "deployLogout") {
            connDeploy.conn = null;
            connDeploy.username = null;
            return false;
        }

		if (request.proxyFunction == "cancelDeploy") {
			connDeploy.conn.metadata.cancelDeploy(request.currentId, function (err, response) {
				sendResponse({result: null, response: response, err: err});
				//console.log(response);
				console.log(err);
			});
			return true;
		}
});

function setLocalConn(sendResponse, sessionId, serverUrl) {
   // if (sessionId) {
        connLocal.conn = new jsforce.Connection({
            'serverUrl': serverUrl,
            'sessionId': sessionId,
            'version': CSH_APIVERSION
        });
        connLocal.conn.metadata.pollTimeout = POLLTIMEOUT;
        connLocal.conn.metadata.pollInterval = POLLINTERVAL;

        //TODO check first for a sessionId, if not use Oauth,
        sendResponse();
   // } else {
    //    connectToLocalOauth(sendResponse);
    //}
}

function connectToDeploy(sendResponse, environment) {
    connectToOrg(sendResponse, environment, connDeploy);
}


function connectToLocalOauth(sendResponse) {
    connectToOrg(sendResponse, 'sandbox', connLocal);
}


function connectToOrg(sendResponse, environment, connObj) {
    if (connObj.conn != null) {
        sendResponse({'oauth': 'response', 'username': connObj.username});
    } else {
        var auth_url = sandbox_auth_url;
        if (environment == "prod") {
            auth_url = prod_auth_url;
        }

        chrome.identity.launchWebAuthFlow({'url': auth_url, 'interactive': true}, function (redirect_url) {
            //console.log(redirect_url);
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
                sendResponse({'oauth': 'response', 'error': chrome.runtime.lastError.message});
            }
            var oauthtoken = getAccessToken(redirect_url);
            var instanceUrl = getInstanceUrl(redirect_url);

            connObj.conn = new jsforce.Connection({
                instanceUrl: instanceUrl,
                accessToken: oauthtoken,
                'version': CSH_APIVERSION

            });
            connObj.conn.metadata.pollTimeout = POLLTIMEOUT;
            connObj.conn.metadata.pollInterval = POLLINTERVAL;


            connObj.conn.chatter.resource('/users/me').retrieve(function (err, res) {
                var username = "Unknown username";
                if (err) {
                    console.error(err);
                } else {
                    username = res.username;
                    connObj.username = username;
                }
                sendResponse({'oauth': 'response', 'username': username});
            });

        });
    }
}

function getAccessToken(url) {
    var subStr = url.match("#access_token=(.*?)&");
    return (decodeURIComponent(subStr[1]));
}

function getInstanceUrl(url) {
    var subStr = url.match("instance_url=(.*?)&");
    return (decodeURIComponent(subStr[1]));
}

function downloadLocalMetadata(sendResponse, changename) {
    //console.log(connLocal);
    console.log('Downloading');
    downloadMetadata(sendResponse, changename, connLocal);
}

function downloadMetadata(sendResponse, changename, connObj) {
        var zipStream = connObj.conn.metadata.retrieve(
            {
                singlePackage: false,
                apiVersion: CSH_APIVERSION,
                packageNames: [changename]
            }).stream();

        var zipData = '';
        zipStream.on('data', function (data) {
            zipData += data.toString('base64');
        });
        zipStream.on('end', function () {
            //console.log(zipData);
            var result = {};
            result.zipFile = zipData;
            sendResponse({result: result});
        });
        zipStream.on('error', function (err) {
            console.error(err);
            sendResponse({err: err});
        });

}
function dummyReturn(){}

function deploy(port, opts, changename, sessionId, serverUrl) {
    setLocalConn(dummyReturn,sessionId, serverUrl);
    var zipStream = connLocal.conn.metadata.retrieve({singlePackage: false, packageNames: [changename]}).stream();

    var zipData = '';
    zipStream.on('data', function (data) {
        zipData += data.toString('base64');
    });
    zipStream.on('end', function () {
        console.log('Done downloading');
        port.postMessage({response: 'Done downloading'})
        deployToSF(zipData, port, opts);
    });
    zipStream.on('error', function (err) {
        //TODO send error
        console.error(err);
        port.postMessage({response: 'Error', err: err})
    });
}


function deployToSF(zipfile, port, opts) {
    //Testlevel is NoTestRun, RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg
    connDeploy.conn.metadata.deploy(zipfile, opts)
        .on('progress', function (result) {
                connDeploy.conn.metadata.checkDeployStatus(result.id, true, function (err, response) {
                    port.postMessage({result: result, response: response, err: err});
                    //console.log(result);
                });
            }
        )
        .complete(true, function (err, result) {
            if (err) {
                console.error(err);
                port.postMessage({result: null, response: null, err: err});
            } else {
                //console.log(result);
                port.postMessage({response: null, err: null, result: result});
            }
        });

}


function quickDeploy(port, currentId) {
    var quickDeployResult = connDeploy.conn.metadata.quickDeploy(currentId);

    quickDeployResult
        .on('progress', function (result) {
                connDeploy.conn.metadata.checkDeployStatus(result.id, true, function (err, response) {
                    //console.log(result);
                    console.log(err);
                    port.postMessage({result: result, response: response, err: err});
                });
            }
        )
        .complete(true, function (err, result) {
            if (err) {
                console.debug(err);
                port.postMessage({result: null, response: null, err: err.toString()});
            } else {
                //console.log(result);
                port.postMessage({response: null, err: null, result: result});
            }
        });
}


function compareContents(type, item) {
    chrome.windows.create({'url': "compare.html?item=" + item, 'type': "popup", "focused": false},
        function (newWin) {
            getContents(type, item, connLocal, "lhs");
            getContents(type, item, connDeploy, "rhs");
    });

}
function getContents(type, item, connObj, side) {
        var memberItems = [];
        memberItems.push(item);
        var unpackaged = {
            types: [{name: type, members: memberItems}]
        };

        var zipData = '';
        var result = connObj.conn.metadata.retrieve({
            apiVersion: CSH_APIVERSION,
            singlePackage: false,
            unpackaged: unpackaged
        }).stream();
        result.on('data', function (data) {
            zipData += data.toString('base64');
        });
        result.on('end', function () {
            //console.log(zipData);
            var result = {};
            result.zipFile = zipData;
            chrome.runtime.sendMessage({'setSide': side, 'content': result, 'compareItem': item});
        });
        result.on('error', function (err) {
            console.error(err);
            chrome.runtime.sendMessage({'setSide': side, 'err': err});
        });

}



	

