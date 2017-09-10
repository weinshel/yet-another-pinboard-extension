///<reference path="pin.ts" />
"use strict";
let connector = (() => {
    const API_URL = Object.freeze({
        addPin: "https://api.pinboard.in/v1/posts/add",
        deletePin: "https://api.pinboard.in/v1/posts/delete",
        getAllPins: "https://api.pinboard.in/v1/posts/all",
        // getAuthToken: "https://api.pinboard.in/v1/user/auth_token",
        getLastUpdate: "https://api.pinboard.in/v1/posts/update",
        suggestTags: "https://api.pinboard.in/v1/posts/suggest",
    });

    const lastUpdate = 0;
    const MIN_INTERVAL = 3 * 1000;
    const MIN_INTERVAL_ALL = 5 * 60 * 1000;
    let interval = MIN_INTERVAL;
    let intervalAll = MIN_INTERVAL_ALL;
    let localQueue = Array<{params: any, reject: (message: any) => void,
                            resolve: (message: any) => void, type: string}>();
    const lastGetAllPins = new Date(0);
    let lastRequest = new Date(0);

    // Needed for the initial startUp(). In case a new request comes in really quick,
    // this de-duplicates the proceedQueue call.
    let hasQueueStarted = false;
    startUp();

    // let queue = new Array();
    // Array.prototype.queue = function (item) {
    //     this.push(item);
    //     browser.storage.local.set({"queue": this}).then(() => {
    //         if (this.length == 1) {
    //         proceedQueue();
    //     }
    //     });
    // }

    async function startUp() {
        const queue = await getQueue();
        localQueue = queue.concat(localQueue);
        if (queue.length > 0 && !hasQueueStarted) {
            cleanQueueDuplicates();
            proceedQueue();
        }
    }

    function saveQueue(queue) {
        return browser.storage.local.set({ queue });
    }

    function addToQueue(item) {
        hasQueueStarted = true;
        localQueue.push(item);
        saveQueue(localQueue);
        cleanQueueDuplicates();
        if (localQueue.length === 1) {
            if (lastRequest < new Date(Date.now() - MIN_INTERVAL)) {
                proceedQueue();
            } else {
                setTimeout(proceedQueue, interval);
            }
        }
    }

    function makeParamString(params) {
        if (typeof params !== "object") {
            return "";
        }
        let paramStr = "";
        for (const prop in params) {
            // Needs to be for .. in, I don't quite undertsand why
            if (params.hasOwnProperty(prop)) {
                paramStr += "&" + encodeURIComponent(prop) + "=" + encodeURIComponent(params[prop]);
            }
        }
        return paramStr;
    }

    async function getQueue() {
        const token = await browser.storage.local.get("queue");
        if (token.hasOwnProperty("queue") && typeof token.queue === "object") {
            return token.queue;
        } else {
            return new Array();
        }
    }

    function cleanQueueDuplicates() {
        let update = false;
        let getAll = false;
        const newQueue = Array();
        for (const item of localQueue) {
            if (item.type === "getLastUpdate") {
                if (!update) {
                    newQueue.push(item);
                    update = true;
                }
            } else if (item.type === "getAllPins") {
                if (!getAll) {
                    newQueue.push(item);
                    getAll = true;
                }
            } else {
                newQueue.push(item);
            }
        }
        localQueue = newQueue;
    }

    function proceedQueue() {
        lastRequest = new Date();
        if (localQueue.length === 0) {
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
            .then((json) => {
                if (typeof json !== "object" || (json.length === 1 && typeof json[0] !== "object")) {
                    item.reject(Error(json));
                    return;
                } else {
                    item.resolve(json);
                }
            })
            .catch((error) => {
                intervalAll *= 2;
                setTimeout(proceedGetAllData, intervalAll, item);
            });
    }

    async function sendRequest(item) {
        const apikey = (await browser.storage.local.get(["apikey"])).apikey;
        return fetch(API_URL[item.type] + "?auth_token=" + encodeURIComponent(apikey) + "&format=json" +
            makeParamString(item.params));
    }

    function validateResponse(response) {
        if (!response.ok || response.status !== 200) {
            throw Error(String(response.status) + " " + response.statusText);
        }
        return response;
    }

    function parseJSON(response) {
        return response.json();
    }

    async function handleResultJSON(json) {
        switch (localQueue[0].type) {
            case "getLastUpdate":
                if (!json.hasOwnProperty("update_time")) {
                    throw Error(json);
                } else {
                    return new Date(json.update_time);
                }
            case "addPin":
                if (json.result_code !== "done") {
                    throw Error(json.result_code);
                }
                break;
            case "suggestTags":
                if (typeof json !== "object") {
                    throw Error(json);
                } else {
                    let tags = new Array();
                    json.forEach((element) => {
                        if (element.hasOwnProperty("popular")) {
                            tags = tags.concat(element.popular);
                        } else if (element.hasOwnProperty("recommended")) {
                            tags = tags.concat(element.recommended);
                        }
                    });
                    return tags;
                }
        }
        return json;
    }

    function onSuccess(result) {
        browser.browserAction.setBadgeBackgroundColor({color: "#333"});
        browser.browserAction.setBadgeText({text: ""});
        browser.browserAction.setTitle({title: "Yet Another Pinboard Extension"});
        intervalAll = MIN_INTERVAL_ALL;
        interval = MIN_INTERVAL;
        const promise = localQueue.shift();
        saveQueue(localQueue);
        if (typeof promise.resolve === "function") {
            promise.resolve(result);
        }
        if (localQueue.length > 0) {
            setTimeout(proceedQueue, interval);
        }
    }

    function onError(error) {
        interval *= 2;
        browser.browserAction.setBadgeBackgroundColor({color: "#f00"});
        browser.browserAction.setBadgeText({text: "X"});
        browser.browserAction.setTitle({title: String(error)});
        setTimeout(proceedQueue, interval);
        // Possible:
        // queue.shift().reject(error);
    }

    // Public methods of the connector "class"
    return {
        getLastUpdate(): Promise<Date> {
            return new Promise((resolve, reject) => {
                addToQueue({
                    params: {},
                    reject,
                    resolve,
                    type: "getLastUpdate",
                });
            });

        } ,
        addPin(pin: Pin): Promise<any> {
            return new Promise((resolve, reject) => {
                addToQueue({
                    params: pin,
                    reject,
                    resolve,
                    type: "addPin",
                });
            })
        },
        getAllPins(): Promise<any[]> {
            return new Promise((resolve, reject) => {
                setTimeout(proceedGetAllData, Math.max(0, intervalAll -
                    (Date.now() - lastGetAllPins.getTime())), { // TODO CHECK THIS
                    params: {},
                    reject,
                    resolve,
                    type: "getAllPins",
                });
            });
        },
        deletePin(pin: Pin) {
            return new Promise((resolve, reject) => {
                addToQueue({
                    params: pin,
                    reject,
                    resolve,
                    type: "deletePin",
                });
            });
        },
        suggestTags(url): Promise<string[]> {
            return new Promise((resolve, reject) => {
                if (typeof url === "string") {
                    url = {href: url};
                }
                addToQueue({
                    params: url,
                    reject,
                    resolve,
                    type: "suggestTags",
                });
            });
        },
    };
})();
