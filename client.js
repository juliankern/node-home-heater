let config;
let sensor;
let gpio;
let utils;
let temperatureInterval;

module.exports = (cfg, tools) => {
    config = cfg;
    utils = tools;
    
    if (config.sensor) {
        sensor = require('./lib/sensors.js')(config.sensor.model);
    }
    
    if (config.relay) {
        gpio = require('./lib/gpio.js');
    }
    
    return {
        load,
        unload
    }
}

async function load(socket) {
    socket.emit('pluginloaded');
    
    if (config.sensor) {
        socket.emit('temperature', { value: (await _getTemperature()), time: Date.now() });
        temperatureInterval = setInterval(async () => {
            global.log('Send temperature', (await _getTemperature()));
            socket.emit('temperature', { value: (await _getTemperature()), time: Date.now() });
        }, (config.sensor.interval || 30) * 1000);
    }
    
    if (config.relay) {
        gpio.setup(config.relay, gpio.DIR_HIGH, () => {
            // gpio is ready
            socket.on('on', (cb) => {
                gpio.write(config.relay, true, cb);
            });

            socket.on('off', (cb) => {
                gpio.write(config.relay, false, cb);
            });
            
            socket.on('identify', (paired, cb) => {
                global.muted('HomeKit identify - paired:', paired);
                cb({ success: true });
            })
        });
    }
    
    return true;
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