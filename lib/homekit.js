let HomeKit;

try {
    HomeKit = require('homekit');
} catch(e) {
    global.warn('HomeKit fake loaded');

    function HKFake() {
        var self = this;
        let functions = {
            on: () => {},
            addService: () => { return functions; },
            getService: () => { return functions; },
            setCharacteristic: () => { return functions; },
            getCharacteristic: () => { return functions; },
            publish: () => { return functions; }
        };

        this.uuid = { generate: () => { return 1; } },
        this.Accessory = function () { 
            Object.assign(this, functions); 
        };

        this.Service = {};
        this.Characteristic = {
            TemperatureDisplayUnits: {
                CELSIUS: 0,
                FAHRENHEIT: 1
            }
        };
    }

    HomeKit = new HKFake();
}

module.exports = HomeKit;
