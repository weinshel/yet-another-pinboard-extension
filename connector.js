"use strict";
let connector = (function () {
    let API_URL = Object.freeze({
        getLastUpdate: "https://api.pinboard.in/v1/posts/update",
        addPin: "https://api.pinboard.in/v1/posts/add",
        getAllPins: "https://api.pinboard.in/v1/posts/all",
        getAPIToken: "https://api.pinboard.in/v1/user/api_token",
        deletePin: "https://api.pinboard.in/v1/posts/delete",
        suggestTags: "https://api.pinboard.in/v1/posts/suggest"
    });

    let lastUpdate = 0;
    const MIN_INTERVAL = 3 * 1000;
    const MIN_INTERVAL_ALL = 5 * 60 * 1000;
    let interval = MIN_INTERVAL;
    let intervalAll = MIN_INTERVAL_ALL;
    let localQueue = Array();
    let lastGetAllPins = new Date(0);
    let lastRequest = new Date(0);

    // Needed for the initial startUp(). In case a new request comes in really quick,
    // this de-duplicates the proceedQueue call.
    let hasQueueStarted = false; 
    startUp();


    //let queue = new Array();
    // Array.prototype.queue = function (item) {
    //     this.push(item);
    //     browser.storage.local.set({"queue": this}).then(() => {
    //         if (this.length == 1) {
    //         proceedQueue();
    //     }
    //     });
    // }

    function startUp() {
        //console.log("starting");
        getQueue().then(queue => {
            localQueue = queue.concat(localQueue);
            if (queue.length > 0 && !hasQueueStarted) {
                proceedQueue();
            }
        });
    }

    function saveQueue(queue) {
        return browser.storage.local.set({ "queue": queue });
    }

    function addToQueue(item) {
        hasQueueStarted = true;
        localQueue.push(item);
        //console.log("new queue length: ", localQueue.length);
        saveQueue(localQueue);
        if (localQueue.length == 1) {
            if (lastRequest < new Date(Date.now() - MIN_INTERVAL)) {
                proceedQueue();
            }
            else {
                setTimeout(proceedQueue, interval);
            }
        }
    }

    function makeParamString(params) {
        if (typeof params !== "object") {
            return "";
        }
        let paramStr = "";
        for (let prop in params) {
            paramStr += "&" + encodeURIComponent(prop) + "=" + encodeURIComponent(params[prop]);
        }
        return paramStr;
    }

    function getQueue() {
        return new Promise((resolve, reject) => {
            browser.storage.local.get("queue").then(token => {
                if (token.hasOwnProperty("queue") && typeof token.queue === "object") {
                    resolve(token.queue);
                }
                else {
                    resolve(new Array());
                }
            });
        });
    }

    function proceedQueue() {
        //console.log("Proceeding in queue");
        if (localQueue.length == 0) {
            return;
        }
        sendRequest(localQueue[0])
            .then(validateResponse)
            .then(parseJSON)
            .then(handleResultJSON)
            .then(onSuccess)
            .catch(onError);
    }

    function proceedGetAllData(item) {
        sendRequest(item)
            .then(validateResponse)
            .then(parseJSON)
            .then(json => {
                if (typeof json !== "object" || (json.length == 1 && typeof json[0] !== "object")) {
                    item.reject(Error(json));
                    return;
                }
                else {
                    item.resolve(json);
                }
            })
            .catch((error) => {
                intervallAll *= 2;
                setTimeout(proceedGetAllData, intervalAll, item);
            });
    }

    function sendRequest(item) {
        //console.log("queue: ", localQueue);
        return fetch(API_URL[item.type] + "?auth_token=seeba:7D0373252F9316ADDABD&format=json" +
            makeParamString(item.params));
    }

    function validateResponse(response) {
        lastRequest = new Date();
        //console.log(response);
        if (!response.ok || response.status != 200) {
            throw Error(response.status);
        }
        return response;
    }

    function parseJSON(response) {
        return response.json();
    }

    function handleResultJSON(json) {
        return new Promise((resolve, reject) => {
            switch (localQueue[0].type) {
                
                case "getLastUpdate":
                    if (!json.hasOwnProperty("update_time")) {
                        reject(Error(json));
                        return;
                    }
                    else {
                        resolve(new Date(json["update_time"]));
                        return;
                    }
                case "addPin":
                    if (json.result_code != "done") {
                        reject(Error(json["result_code"]));
                        return;
                    }
                    break;
                case "suggestTags":
                    if(typeof json !== "object") {
                        console.log("noobject");
                        reject(Error(json));
                        return;
                    }
                    else {
                        let tags = new Array();
                        json.forEach((element) => {
                            if(element.hasOwnProperty("popular")) {
                                tags = tags.concat(element["popular"]);
                            }
                            else if(element.hasOwnProperty("recommended")) {
                                tags = tags.concat(element["recommended"]);
                            }
                        });
                        resolve(tags);
                        return;
                    }
                default:
                    // console.log("No special condition");
                    // console.log(json);
            }
            resolve(json);
        });
    }

    function onSuccess(result) {
        intervalAll =MIN_INTERVAL_ALL;
        interval = MIN_INTERVAL;
        let promise = localQueue.shift();
        saveQueue(localQueue).then();
        if (typeof promise.resolve === "function") {
            promise.resolve(result);
        }
        else {
            // console.log(typeof promise.resolve);
        }
        if (localQueue.length > 0) {
            setTimeout(proceedQueue, interval);
        }
    }

    function onError(error) {
        //console.log("There was an error:\n", error);
        interval *= 2;
        setTimeout(proceedQueue, interval);
        // Possible: 
        // queue.shift().reject(error);
    }

    // Public methods of the connector "class"
    return {
        getLastUpdate: function () {
            //console.log("update");
            return new Promise((resolve, reject) => {
                addToQueue({
                    "type": "getLastUpdate",
                    "params": {},
                    "resolve": resolve,
                    "reject": reject
                });
            });

        },
        addPin: function (pin) {
            //console.log("save", pin);
            if(pin.hasOwnProperty("href")) {
                pin["url"] = pin.href;
            }
            return new Promise((resolve, reject) => {
                addToQueue({
                    "type": "addPin",
                    "params": pin,
                    "resolve": resolve,
                    "reject": reject
                });
            })
        },
        getAllPins: function () {
            //console.log("getAll");
            return new Promise((resolve, reject) => {
                setTimeout(proceedGetAllData, Math.max(0, intervalAll - (Date.now() - lastGetAllPins)), {
                    "type": "getAllPins",
                    "params": {},
                    "resolve": resolve,
                    "reject": reject
                });
            });
        },
        deletePin: function (pin) {
            if(typeof pin === "string") {
                    pin = {"url": pin};
            }
            else if(pin.hasOwnProperty("href")) {
                pin["url"] = pin.href;
            }
            
            return new Promise((resolve, reject) => {
                addToQueue({
                    "type": "deletePin",
                    "params": pin,
                    "resolve": resolve,
                    "reject": reject
                });
            });
        },
        suggestTags: function (url) {
            
            return new Promise((resolve, reject) => {
                if(typeof url === "string") {
                    url = {"url": url};
                }
                addToQueue({
                    "type": "suggestTags",
                    "params": url,
                    "resolve": resolve,
                    "reject": reject
                });
            });
        }
    };
})();
