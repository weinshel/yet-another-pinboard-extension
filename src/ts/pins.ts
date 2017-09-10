///<reference path="pin.ts" />
"use strict";
class Pins extends Map<string, Pin> {
    public static async updateList(forceUpdate: boolean = false): Promise<Pins> {
        const token = await browser.storage.local.get(["apikey", "pins"]);
        // Plus 5 at the end for buffer, in order for the alarm to trigger this usually.
        if (!token.hasOwnProperty("apikey") || token.apikey === "") {
            return new Pins();
        }
        const lastSync = await this.getStoredLastSync();
        if (!forceUpdate && lastSync.getTime() > new Date(Date.now() - 1000 * 60 * 5 + 5).getTime()) {
            // Not forced and last sync less than 5 minutes ago, therefore we just get the stored object
            return Pins.getObject();
        }
        const lastUpdate = await connector.getLastUpdate();
        const storedLastUpdate = await this.getStoredLastUpdate();
        // To compare Dates: https://stackoverflow.com/a/493018
        if (!forceUpdate && token.hasOwnProperty("pins") && token.pins.length > 0 &&
            storedLastUpdate.getTime() === lastUpdate.getTime()) {
            // Pinboard's last update is the same as the one stored, and the pins Array is non-empty
            // therefore we just get the stored object
            return Pins.getObject();

        }
        return Pins.sendRequestAllPins(lastUpdate);
    }
    /**
     * Requests all pins from pinboard
     * @param lastUpdate Timestamp of the last update requested before,
     * so the storage can be updated if it was successful
     */
    public static async sendRequestAllPins(lastUpdate) {
        const pins = new Pins();
        const json = await connector.getAllPins();
        json.reverse().forEach((pin) => {
            pins.set(pin.href, new Pin(
                // pinboard API gets pin with attribute href, and addPin wants url. so we standardise to url
                pin.href,
                pin.description,
                pin.tags,
                pin.time,
                pin.extended,
                pin.toread,
                pin.shared));
        });
        pins.saveToStorage();
        browser.storage.local.set({ lastupdate: lastUpdate.getTime() });
        browser.storage.local.set({ lastsync: new Date().getTime() });
        return pins;
    }

    public static async getObject() {
        const res = await browser.storage.local.get("pins");
        if (res.pins === undefined) {
            return new Pins();
        } else {
            const pins = new Pins();
            for (const p of res.pins) {
                pins.set(p[0], Pin.fromObject(p[1]));
            }
            return pins;
        }
    }

    private static async getStoredLastUpdate() {
        const token = await browser.storage.local.get("lastupdate");
        if (token.hasOwnProperty("lastupdate")) {
            return new Date(token.lastupdate);
        }
        return new Date(0);
    }

    private static async getStoredLastSync() {
        const token = await browser.storage.local.get("lastsync");
        if (token.hasOwnProperty("lastsync")) {
            return new Date(token.lastsync);
        }
        return new Date(0);
    }

    private constructor(i?: any) {
        super(i);
    }

    public set(key: string, pin: Pin) {
        super.set(key, pin);
        return this;
    }
    public delete(key: string) {
        const result = super.delete(key);
        this.saveToStorage();
        return result;
    }

    public addPin(pin: Pin) {
        this.set(pin.url, pin);
        this.saveToStorage();
    }

    public *forEachReversed() {
        for (const [url, pin] of Array.from(this.entries()).reverse()) {
            yield pin;
        }
    }

    public saveToStorage() {
        browser.storage.local.set({pins: Array.from(this.entries())});
    }
}
