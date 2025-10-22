// Manifest V3 service worker
// JSforce operations are handled in offscreen.html/offscreen.js due to XMLHttpRequest requirement

var CSH_APIVERSION = "60.0";
const versionPattern = RegExp('^[0-9][0-9]\.0$');

chrome.storage.sync.get(['salesforceApiVersion'], function(items) {
    if (items.salesforceApiVersion) {
        CSH_APIVERSION = versionPattern.test(items.salesforceApiVersion) ? items.salesforceApiVersion : '60.0';
        console.log('Service Worker - API Version:', CSH_APIVERSION);
    }
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (changes.salesforceApiVersion) {
        CSH_APIVERSION = versionPattern.test(changes.salesforceApiVersion.newValue) ? changes.salesforceApiVersion.newValue : '60.0';
        console.log('Service Worker - API Version changed:', CSH_APIVERSION);
    }
});

const POLLTIMEOUT = 20*60*1000; // 20 minutes
const POLLINTERVAL = 5000; //5 seconds

var client_id = '3MVG97quAmFZJfVzlPO9kMeS90FBVJuF7x_gWYYRdhK9UAMWuk9WVaCMTqKAUEf2u4ge.OhGG_2vYl.EO3e.i';

var redirectUri = chrome.identity.getRedirectURL("sfdc");

var sandbox_auth_url = "https://test.salesforce.com/services/oauth2/authorize?display=page&prompt=select_account&response_type=token&client_id=" + client_id + "&redirect_uri=" + redirectUri;
var prod_auth_url = "https://login.salesforce.com/services/oauth2/authorize?display=page&response_type=token&prompt=select_account&client_id=" + client_id + "&redirect_uri=" + redirectUri;

// Keep service worker alive during long-running operations
let keepAliveInterval = null;

function startKeepAlive() {
    if (!keepAliveInterval) {
        keepAliveInterval = setInterval(() => {
            chrome.runtime.getPlatformInfo(() => {
                // Just checking to keep service worker alive
            });
        }, 20000); // Every 20 seconds
    }
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// Offscreen document management
let creating; // A global promise to avoid concurrency issues
let offscreenReady = false;

//offscreen.html
async function setupOffscreenDocument(path) {
    try {
        // Check if offscreen API is available
        if (!chrome.offscreen) {
            throw new Error('chrome.offscreen API not available. Chrome 109+ required.');
        }

        const offscreenUrl = chrome.runtime.getURL(path);
        console.log('Setting up offscreen document:', offscreenUrl);

        // Check if offscreen document already exists
        let existingContexts = [];
        if (chrome.runtime.getContexts) {
            existingContexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [offscreenUrl]
            });
        }

        if (existingContexts.length > 0) {
            console.log('Offscreen document already exists');
            return;
        }

        if (creating) {
            console.log('Waiting for existing creation promise...');
            await creating;
        } else {
            console.log('Creating new offscreen document...');
            creating = chrome.offscreen.createDocument({
                url: path,
                reasons: ['DOM_SCRAPING'], // Using DOM_SCRAPING as it allows XMLHttpRequest
                justification: 'JSforce library requires XMLHttpRequest for Salesforce API communication'
            });
            await creating;
            creating = null;
            console.log('Offscreen document created successfully');
        }
    } catch (err) {
        console.error('Failed to create offscreen document:', err);
        console.error('Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        creating = null;
        throw err;
    }
}

async function sendToOffscreen(message) {
    try {
        await setupOffscreenDocument('offscreen.html');

        // Wait longer for offscreen document to fully load and initialize
        // JSforce is a large library that needs time to load
        await new Promise(resolve => setTimeout(resolve, 500));

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('sendMessage error:', chrome.runtime.lastError.message);
                    console.error('Message was:', message);
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    } catch (err) {
        console.error('sendToOffscreen failed:', err);
        throw err;
    }
}

// Port-based handlers for long-running operations
chrome.runtime.onConnect.addListener(function (port) {
    if (port.name == "deployHandler") {
        startKeepAlive();
        port.onMessage.addListener(async function (request) {
            if (request.proxyFunction == "deploy") {
                await deploy(port, request.opts, request.changename, request.sessionId, request.serverUrl);
            }
        });
        port.onDisconnect.addListener(() => {
            stopKeepAlive();
        });
    }

    if (port.name == "quickDeployHandler") {
        startKeepAlive();
        port.onMessage.addListener(async function (request) {
            if (request.proxyFunction == "quickDeploy") {
                await quickDeploy(port, request.currentId);
            }
        });
        port.onDisconnect.addListener(() => {
            stopKeepAlive();
        });
    }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Listen for offscreen document ready signal
    if (request.action === 'offscreenReady') {
        console.log('Offscreen document signaled ready!');
        offscreenReady = true;
        return false;
    }

    // Handle OAuth requests (these stay in service worker as chrome.identity works here)
    if (request.oauth == "request") {
        getSfdcOauth2(sendResponse, request.environment);
        return true;
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
        sendToOffscreen({action: 'deployLogout'}).then(() => {
            sendResponse({success: true});
        }).catch(err => {
            console.error('Error in deployLogout:', err);
            sendResponse({success: false, error: err.message});
        });
        return true;
    }

    // Proxy metadata operations to offscreen document
    if (request.proxyFunction == "listDeployMetaData") {
        sendToOffscreen({
            action: 'listMetadata',
            connType: 'deploy',
            types: request.proxydata
        }).then(response => {
            sendResponse({err: response.error || null, results: response.results});
        }).catch(err => {
            console.error('Error in listDeployMetaData:', err);
            sendResponse({err: err.message, results: null});
        });
        return true;
    }

    if (request.proxyFunction == "listLocalMetaData") {
        sendToOffscreen({
            action: 'listMetadata',
            connType: 'local',
            types: request.proxydata
        }).then(response => {
            sendResponse({err: response.error || null, results: response.results});
        }).catch(err => {
            console.error('Error in listLocalMetaData:', err);
            sendResponse({err: err.message, results: null});
        });
        return true;
    }

    if (request.proxyFunction == "downloadLocalMetadata") {
        sendToOffscreen({
            action: 'downloadMetadata',
            connType: 'local',
            changename: request.changename
        }).then(response => {
            if (response.error) {
                sendResponse({err: response.error});
            } else {
                sendResponse({result: response.result});
            }
        }).catch(err => {
            console.error('Error in downloadLocalMetadata:', err);
            sendResponse({err: err.message});
        });
        return true;
    }

    if (request.proxyFunction == "getDeployUsername") {
        sendToOffscreen({action: 'getDeployUsername'}).then(response => {
            sendResponse(response.username);
        }).catch(err => {
            console.error('Error in getDeployUsername:', err);
            sendResponse(null);
        });
        return true;
    }

    if (request.proxyFunction == "compareContents") {
        compareContents(request.entityType, request.itemName);
        return false;
    }

    if (request.proxyFunction == "cancelDeploy") {
        sendToOffscreen({
            action: 'cancelDeploy',
            deployId: request.currentId
        }).then(response => {
            sendResponse({result: null, response: response.response, err: response.error});
        }).catch(err => {
            console.error('Error in cancelDeploy:', err);
            sendResponse({result: null, response: null, err: err.message});
        });
        return true;
    }
});

async function setLocalConn(sendResponse, sessionId, serverUrl) {
    try {
        await sendToOffscreen({
            action: 'setLocalConn',
            sessionId: sessionId,
            serverUrl: serverUrl
        });
        sendResponse();
    } catch (err) {
        console.error('Error in setLocalConn:', err);
        sendResponse({error: err.message});
    }
}

function connectToDeploy(sendResponse, environment) {
    connectToOrg(sendResponse, environment, 'deploy');
}

function connectToLocalOauth(sendResponse) {
    connectToOrg(sendResponse, 'sandbox', 'local');
}

function connectToOrg(sendResponse, environment, connType) {
    var auth_url = sandbox_auth_url;
    if (environment == "prod") {
        auth_url = prod_auth_url;
    }

    chrome.identity.launchWebAuthFlow({'url': auth_url, 'interactive': true}, async function (redirect_url) {
        if (chrome.runtime.lastError) {
            console.log(chrome.runtime.lastError.message);
            sendResponse({'oauth': 'response', 'error': chrome.runtime.lastError.message});
            return;
        }

        try {
            var oauthtoken = getAccessToken(redirect_url);
            var instanceUrl = getInstanceUrl(redirect_url);

            // Send credentials to offscreen document to create connection
            const response = await sendToOffscreen({
                action: 'connectToOrg',
                environment: environment,
                connType: connType,
                instanceUrl: instanceUrl,
                accessToken: oauthtoken
            });

            if (response.error) {
                sendResponse({'oauth': 'response', 'error': response.error});
            } else {
                sendResponse({'oauth': 'response', 'username': response.username});
            }
        } catch (err) {
            console.error('Error in connectToOrg:', err);
            sendResponse({'oauth': 'response', 'error': err.message});
        }
    });
}

function getAccessToken(url) {
    var subStr = url.match("#access_token=(.*?)&");
    return (decodeURIComponent(subStr[1]));
}

function getInstanceUrl(url) {
    var subStr = url.match("instance_url=(.*?)&");
    return (decodeURIComponent(subStr[1]));
}

async function deploy(port, opts, changename, sessionId, serverUrl) {
    try {
        // First set up local connection
        await sendToOffscreen({
            action: 'setLocalConn',
            sessionId: sessionId,
            serverUrl: serverUrl
        });

        port.postMessage({response: 'Downloading metadata...'});

        // Retrieve metadata
        const retrieveResponse = await sendToOffscreen({
            action: 'retrieveMetadata',
            connType: 'local',
            opts: {
                singlePackage: false,
                packageNames: [changename]
            }
        });

        if (retrieveResponse.error) {
            port.postMessage({response: 'Error', err: retrieveResponse.error});
            return;
        }

        port.postMessage({response: 'Done downloading, starting deploy...'});

        // Deploy to target org - this will be handled via polling
        await deployToSF(retrieveResponse.zipData, port, opts);

    } catch (err) {
        console.error(err);
        port.postMessage({response: 'Error', err: err.toString()});
    }
}

async function deployToSF(zipData, port, opts) {
    // Set up polling for deploy status
    const deployResponse = await sendToOffscreen({
        action: 'deploy',
        zipData: zipData,
        opts: opts
    });

    if (deployResponse.error) {
        port.postMessage({result: null, response: null, err: deployResponse.error});
    } else {
        // Deploy initiated, start polling for status
        await pollDeployStatus(port, deployResponse.result.id);
    }
}

async function pollDeployStatus(port, deployId) {
    const startTime = Date.now();
    const pollInterval = setInterval(async () => {
        try {
            const statusResponse = await sendToOffscreen({
                action: 'checkDeployStatus',
                deployId: deployId
            });

            if (statusResponse.error) {
                clearInterval(pollInterval);
                port.postMessage({result: null, response: null, err: statusResponse.error});
                return;
            }

            port.postMessage({
                result: {id: deployId, state: statusResponse.result.status},
                response: statusResponse.result,
                err: null
            });

            // Check if deploy is complete
            if (statusResponse.result.done) {
                clearInterval(pollInterval);
                port.postMessage({response: null, err: null, result: statusResponse.result});
            }

            // Timeout check
            if (Date.now() - startTime > POLLTIMEOUT) {
                clearInterval(pollInterval);
                port.postMessage({result: null, response: null, err: 'Deploy timeout'});
            }
        } catch (err) {
            clearInterval(pollInterval);
            port.postMessage({result: null, response: null, err: err.toString()});
        }
    }, POLLINTERVAL);
}

async function quickDeploy(port, currentId) {
    try {
        const response = await sendToOffscreen({
            action: 'quickDeploy',
            deployId: currentId
        });

        if (response.error) {
            port.postMessage({result: null, response: null, err: response.error});
        } else {
            // Quick deploy initiated, start polling
            await pollDeployStatus(port, response.result.id);
        }
    } catch (err) {
        console.error(err);
        port.postMessage({result: null, response: null, err: err.toString()});
    }
}

function compareContents(type, item) {
    chrome.windows.create({'url': "compare.html?item=" + item, 'type': "popup", "focused": false},
        async function (newWin) {
            await getContents(type, item, 'local', "lhs");
            await getContents(type, item, 'deploy', "rhs");
        });
}

async function getContents(type, item, connType, side) {
    try {
        const response = await sendToOffscreen({
            action: 'retrieveMetadata',
            connType: connType,
            opts: {
                apiVersion: CSH_APIVERSION,
                singlePackage: false,
                unpackaged: {
                    types: [{name: type, members: [item]}]
                }
            }
        });

        if (response.error) {
            chrome.runtime.sendMessage({'setSide': side, 'err': response.error});
        } else {
            chrome.runtime.sendMessage({
                'setSide': side,
                'content': {zipFile: response.zipData},
                'compareItem': item
            });
        }
    } catch (err) {
        console.error(err);
        chrome.runtime.sendMessage({'setSide': side, 'err': err.toString()});
    }
}

console.log('Service worker ready');
setupOffscreenDocument('offscreen.html');
