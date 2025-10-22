// Offscreen document for JSforce operations (has access to XMLHttpRequest)

var CSH_APIVERSION = "60.0";
const versionPattern = RegExp('^[0-9][0-9]\.0$');

const POLLTIMEOUT = 20*60*1000; // 20 minutes
const POLLINTERVAL = 5000; //5 seconds

var connDeploy = {conn: null, username: null};
var connLocal = {conn: null, username: null};
var connLocalOauth = {conn: null, username: null};

// Wait for window to load before initializing
console.log('Offscreen.js script loaded');

// Function to initialize
function initializeOffscreen() {
    console.log('Offscreen document initializing...');

    // Wait for jsforce to be available
    if (typeof jsforce === 'undefined') {
        console.error('JSforce library not loaded!');
        // Try again after a short delay
        setTimeout(initializeOffscreen, 100);
        return;
    } else {
        console.log('JSforce library loaded successfully, version:', jsforce.VERSION || 'unknown');
    }

    // Initialize chrome.storage API calls after Chrome APIs are ready
    if (typeof chrome !== 'undefined' && chrome.storage) {
        // Get initial API version from storage
        chrome.storage.sync.get(['salesforceApiVersion'], function(items) {
            if (items.salesforceApiVersion) {
                CSH_APIVERSION = versionPattern.test(items.salesforceApiVersion) ? items.salesforceApiVersion : '60.0';
                console.log('Offscreen - API Version:', CSH_APIVERSION);
            }
        });

        // Listen for API version changes
        chrome.storage.onChanged.addListener(function (changes, areaName) {
            if (changes.salesforceApiVersion) {
                CSH_APIVERSION = versionPattern.test(changes.salesforceApiVersion.newValue) ? changes.salesforceApiVersion.newValue : '60.0';
                console.log('Offscreen - API Version changed:', CSH_APIVERSION);
            }
        });
    } else {
        console.warn('Chrome storage API not available, using default API version:', CSH_APIVERSION);
    }

    // Notify service worker that we're ready
    setTimeout(() => {
        chrome.runtime.sendMessage({action: 'offscreenReady'}).then(() => {
            console.log('Notified service worker that offscreen is ready');
        }).catch(err => {
            console.log('Could not notify service worker:', err.message);
        });
    }, 100);
}

// Initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOffscreen);
} else {
    // Document already loaded
    initializeOffscreen();
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Offscreen received:', request.action);

    switch(request.action) {
        case 'setLocalConn':
            setLocalConn(request.sessionId, request.serverUrl);
            sendResponse({success: true});
            break;

        case 'connectToOrg':
            connectToOrg(request.environment, request.connType, request.instanceUrl, request.accessToken)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({error: err.message}));
            return true; // Keep channel open for async response

        case 'listMetadata':
            listMetadata(request.connType, request.types)
                .then(results => sendResponse({results: results}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'downloadMetadata':
            downloadMetadata(request.connType, request.changename)
                .then(result => sendResponse({result: result}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'retrieveMetadata':
            retrieveMetadata(request.connType, request.opts)
                .then(zipData => sendResponse({zipData: zipData}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'deploy':
            deployToSF(request.zipData, request.opts)
                .then(result => sendResponse({result: result}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'quickDeploy':
            quickDeployToSF(request.deployId)
                .then(result => sendResponse({result: result}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'cancelDeploy':
            cancelDeployment(request.deployId)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'checkDeployStatus':
            checkDeployStatus(request.deployId)
                .then(result => sendResponse({result: result}))
                .catch(err => sendResponse({error: err.message}));
            return true;

        case 'getDeployUsername':
            sendResponse({username: connDeploy.username});
            break;

        case 'deployLogout':
            connDeploy.conn = null;
            connDeploy.username = null;
            sendResponse({success: true});
            break;
    }
});

function setLocalConn(sessionId, serverUrl) {
    connLocal.conn = new jsforce.Connection({
        'serverUrl': serverUrl,
        'sessionId': sessionId,
        'version': CSH_APIVERSION
    });
    connLocal.conn.metadata.pollTimeout = POLLTIMEOUT;
    connLocal.conn.metadata.pollInterval = POLLINTERVAL;
}

async function connectToOrg(environment, connType, instanceUrl, accessToken) {
    const conn = new jsforce.Connection({
        instanceUrl: instanceUrl,
        accessToken: accessToken,
        'version': CSH_APIVERSION
    });
    conn.metadata.pollTimeout = POLLTIMEOUT;
    conn.metadata.pollInterval = POLLINTERVAL;

    try {
        const res = await conn.chatter.resource('/users/me').retrieve();
        const username = res.username;

        if (connType === 'deploy') {
            connDeploy.conn = conn;
            connDeploy.username = username;
        } else if (connType === 'local') {
            connLocal.conn = conn;
            connLocal.username = username;
        } else if (connType === 'localOauth') {
            connLocalOauth.conn = conn;
            connLocalOauth.username = username;
        }

        return {username: username};
    } catch (err) {
        throw new Error('Failed to connect: ' + err.message);
    }
}

async function listMetadata(connType, types) {
    const conn = connType === 'deploy' ? connDeploy.conn : connLocal.conn;

    if (!conn) {
        throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
        conn.metadata.list(types, CSH_APIVERSION, function(err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
}

async function downloadMetadata(connType, changename) {
    const conn = connType === 'deploy' ? connDeploy.conn : connLocal.conn;

    if (!conn) {
        throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
        const zipStream = conn.metadata.retrieve({
            singlePackage: false,
            apiVersion: CSH_APIVERSION,
            packageNames: [changename]
        }).stream();

        let zipData = '';
        zipStream.on('data', function(data) {
            zipData += data.toString('base64');
        });
        zipStream.on('end', function() {
            resolve({zipFile: zipData});
        });
        zipStream.on('error', function(err) {
            reject(err);
        });
    });
}

async function retrieveMetadata(connType, opts) {
    const conn = connType === 'local' ? connLocal.conn : connDeploy.conn;

    if (!conn) {
        throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
        const zipStream = conn.metadata.retrieve(opts).stream();

        let zipData = '';
        zipStream.on('data', function(data) {
            zipData += data.toString('base64');
        });
        zipStream.on('end', function() {
            resolve(zipData);
        });
        zipStream.on('error', function(err) {
            reject(err);
        });
    });
}

async function deployToSF(zipData, opts) {
    if (!connDeploy.conn) {
        throw new Error('Not connected to deploy org');
    }

    return new Promise((resolve, reject) => {
        // Just initiate the deploy and return the ID immediately
        // The service worker will poll for status
        const deployRequest = connDeploy.conn.metadata.deploy(zipData, opts);

        // Get the deploy ID from the first progress event
        deployRequest.on('progress', function(result) {
            // Return the deploy ID immediately so polling can begin
            resolve({id: result.id, state: result.state});
        });

        deployRequest.on('error', function(err) {
            reject(err);
        });
    });
}

async function quickDeployToSF(deployId) {
    if (!connDeploy.conn) {
        throw new Error('Not connected to deploy org');
    }

    return new Promise((resolve, reject) => {
        // Just initiate the quick deploy and return the ID immediately
        // The service worker will poll for status
        const deployRequest = connDeploy.conn.metadata.quickDeploy(deployId);

        // Get the deploy ID from the first progress event
        deployRequest.on('progress', function(result) {
            // Return the deploy ID immediately so polling can begin
            resolve({id: result.id, state: result.state});
        });

        deployRequest.on('error', function(err) {
            reject(err);
        });
    });
}

async function cancelDeployment(deployId) {
    if (!connDeploy.conn) {
        throw new Error('Not connected to deploy org');
    }

    return new Promise((resolve, reject) => {
        connDeploy.conn.metadata.cancelDeploy(deployId, function(err, response) {
            if (err) {
                reject(err);
            } else {
                resolve({response: response});
            }
        });
    });
}

async function checkDeployStatus(deployId) {
    if (!connDeploy.conn) {
        throw new Error('Not connected to deploy org');
    }

    return new Promise((resolve, reject) => {
        connDeploy.conn.metadata.checkDeployStatus(deployId, true, function(err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

console.log('Offscreen document ready for JSforce operations');
