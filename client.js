const pkg = require('./package.json');

module.exports = async (SmartNodeClientPlugin) => {
    let temperatureInterval;
    let sensor;
    let gpio;
    let config = SmartNodeClientPlugin.config;
    let socket = SmartNodeClientPlugin.socket;
    
    if (config.sensor) {
        sensor = require('./lib/sensors.js')(config.sensor.model);
    }
    
    if (config.relay) {
        gpio = global.req('lib/gpio');
    }
    
    return {
        init,
        load,
        unload,
        unpair
    }

    function init() {
        return [pkg, (data) => {
            console.log('init done', data);
        }];
    }

    function unpair() {
        
    }
    
    async function load() {
        if (config.sensor) {
            let temperature = await _getTemperature();
            global.log('Send temperature', temperature);    
            socket.emit('temperature', { value: temperature, time: Date.now() });
            
            temperatureInterval = setInterval(async () => {
                temperature = await _getTemperature();
                global.log('Send temperature', temperature);
                socket.emit('temperature', { value: temperature, time: Date.now() });
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

        socket.emit('pluginloaded');

        return true;
    }

    function unload() {
        socket.emit('pluginunloaded');
        
        clearInterval(temperatureInterval);
        
        if (gpio) {
            gpio.destroy();
        }

        return true;
    }

    async function _getTemperature() {
        if (config.sensor.model = 'ds1820') {
            return sensor.readDevice(config.sensor.address).then((data) => {
                return data.value;
            });
        }
        
        return new Promise((resolve, reject) => { resolve(false); });
    }
}
