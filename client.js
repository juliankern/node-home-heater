let config;
let sensor;
let gpio;
let temperatureInterval;
let displayTimeout;

module.exports = (cfg) => {
    config = cfg;
    console.log('loaded node-home-heater', config);
    
    if (config.sensor) {
        switch (config.sensor.model) {
            case 'ds1820':
                sensor = require('ds1820-temp');
            break;
        }
    }
    
    if (config.relay || config.button || config.display) {
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
            socket.emit('temperature', (await _getTemperature()));
        }, (config.sensor.interval || 30) * 1000);
    }
    
    if (config.relay) {
        gpio.setup(config.relay, gpio.DIR_OUT);
    }
    
    if (config.display) {
        gpio.setup(config.display, gpio.DIR_OUT);
    }
    
    if (config.button) {
        gpio.on('change', async (channel, value) => {
            if (channel === config.button && value) {
                if (displayTimeout) clearTimeout(displayTimeout);
                
                await gpio.write(config.display, true);
                
                displayTimeout = setTimeout(() => {
                    gpio.write(config.display, false);
                }, (config.display.timeout || 10) * 1000);
            }
        });
        gpio.setup(config.button, gpio.DIR_IN, gpio.EDGE_BOTH);
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