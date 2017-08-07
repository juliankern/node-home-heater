let config;
let sensor;
let gpio;
let temperatureInterval;

module.exports = (cfg) => {
    config = cfg;
    console.log('loaded node-home-heater', config);
    
    if (config.sensor) {
        switch (config.sensor.model) {
            case 'ds1820':
                try {
                    sensor = require('ds1820-temp');
                } catch(e) {
                    sensor = { 
                        readDevice: async () => {
                            return new Promise((resolve, reject) => {  resolve({ value: 21.2 }); });
                        }
                    }
                }
            break;
        }
    }
    
    if (config.relay) {
        try {
            gpio = require('rpi-gpio');
        } catch(e) {
            gpio = { 
                setup: () => {} ,
                on: () => {},
                destroy: () => {}
            }
        }
    }
    
    return {
        load,
        unload
    }
}

function load(socket) {
    console.log('pluginloaded')
    socket.emit('pluginloaded');
    
    if (config.sensor) {
        temperatureInterval = setInterval(async () => {
            console.log('emit temperature', (await _getTemperature()));
            socket.emit('temperature', (await _getTemperature()));
        }, (config.sensor.interval || 30) * 1000);
    }
    
    if (config.relay) {
        gpio.setup(config.relay, gpio.DIR_OUT);
    }
}

function unload(socket) {
    socket.emit('pluginunloaded');
    
    clearInterval(temperatureInterval);
    
    if (gpio) {
        gpio.destroy();
    }
}

async function _getTemperature() {
    if (config.sensor.model = 'ds1820') {
        return sensor.readDevice(config.sensor.address).then((data) => {
            return data.value;
        });
    }
    
    return new Promise((resolve, reject) => { resolve(false); });
}