const pkg = require('./package.json');
const moment = require('moment');

module.exports = async (SmartNodePlugin) => {
    let homekitProperties;
    let nologs = false;

    let config = SmartNodePlugin.config;
    let storage = SmartNodePlugin.storage;

    let HomeKit = require('./lib/homekit.js');
    
    if ((await storage.get('homekit-properties'))) {
        homekitProperties = await storage.get('homekit-properties');
    } else {
        homekitProperties = await generateHomekitProperties();
    }

    SmartNodePlugin.on('globalsChanged', () => {
        console.log('Globals have changed, update?!');
    })
    
    let uuid = HomeKit.uuid.generate(`homekit:${pkg.name}`);

    if (!(await storage.get('temperatureLogs'))) {
        await storage.set('temperatureLogs', []);
        nologs = true;
    }

    return {
        exports: {
            global: {},
            room: {
                temperature: async () => {
                    return {
                        current: await _fixTemperature((await storage.get('currentTemperature')) || (await storage.get('currentTemperature'))),
                        target: await _fixTemperature((await storage.get('targetTemperature'))),
                        unit: !!(await storage.get('temperatureDisplayUnits')) ? 'F' : 'C'
                    }
                }
            }
        },
        load,
        unload
    }
    
    function load(socket) {
        let logTimer = moment();

        socket.on('temperature', async (data) => {
            global.log('SmartNode server got temperature!', data);
            await storage.set('currentTemperature', data.value);

            // log every ~15 min or the first log instantly
            if (moment(data.time).diff(logTimer, 'minutes', true) >= 15 || nologs) {
                logTimer = moment();
                nologs = false;

                let logs = await storage.get('temperatureLogs');
                logs.push({ time: data.time, value: data });


                // keep logs only 10 days
                if (logs.length > 960) logs.shift();

                await storage.set('temperatureLogs', logs);
            }
        });

        let accessory = new HomeKit.Accessory(`Thermostat ${config.room}`, uuid);

        accessory.on('identify', (paired, callback) => {
            if (paired) {
                storage.set('homekit-properties', homekitProperties);
            }
            
            socket.emit('identify', paired, (data) => {
                callback(data.success);
            })
        });

        accessory.getService(HomeKit.Service.AccessoryInformation)
            .setCharacteristic(HomeKit.Characteristic.Manufacturer, 'juliankern.com')
            .setCharacteristic(HomeKit.Characteristic.Model, pkg.name)
            .setCharacteristic(HomeKit.Characteristic.SerialNumber, 'A0000001');

        accessory.addService(HomeKit.Service.Thermostat, `Thermostat ${config.room}`)
            .getCharacteristic(HomeKit.Characteristic.CurrentTemperature)
            .on('get', async (callback) => {
                global.muted('HK get CurrentTemperature:', (await storage.get('currentTemperature')));
                callback(null, (await storage.get('currentTemperature')));
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
            .on('get', async (callback) => {
                global.muted('HK get TargetTemperature:', (await storage.get('targetTemperature')) || (await storage.get('currentTemperature')));
                callback(null, (await storage.get('targetTemperature')) || (await storage.get('currentTemperature')));
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
            .on('set', async (value, callback) => {
                global.muted('HK Set TargetTemperature:', +value);
                await storage.set('targetTemperature', +value);
                callback();
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
            .on('get', async (callback) => {
                global.muted('HK get TemperatureDisplayUnits', (await storage.get('temperatureDisplayUnits')) || HomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
                callback(null, (await storage.get('temperatureDisplayUnits')) || HomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
            .on('set', async (value, callback) => {
                global.muted('HK set TemperatureDisplayUnits:', value);
                await storage.set('temperatureDisplayUnits', value);
                callback();
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.CurrentHeatingCoolingState)
            .on('get', async (callback) => {
                global.muted('HK get CurrentHeatingCoolingState:', (await storage.get('currentHeatingCoolingState')) || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
                callback(null, (await storage.get('currentHeatingCoolingState')) || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.CurrentHeatingCoolingState)
            .on('set', async (value, callback) => {
                global.muted('HK Set CurrentHeatingCoolingState:', value);
                await storage.set('currentHeatingCoolingState', value);
                callback();
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
            .on('get', async (callback) => {
                global.muted('HK get TargetHeatingCoolingState:', (await storage.get('targetHeatingCoolingState')) || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
                callback(null, (await storage.get('targetHeatingCoolingState')) || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
            })
        ;
        
        accessory.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
            .on('set', async (value, callback) => {
                global.muted('HK Set TargetHeatingCoolingState:', value);
                await storage.set('targetHeatingCoolingState', value);
                callback();
            })
        ;
        
        accessory.publish(homekitProperties);
        
        global.muted(`Published HomeKit ${pkg.name} with properties:`, homekitProperties);
    }

    function unload(socket) {
        accessory.destroy();
    }

    async function generateHomekitProperties() {
        let pincode = '';
        let username = '{l}{l}:{i}{i}:{i}{l}:{l}{i}:{l}{l}:{l}{i}'
            .replace(/{i}/g, () => { return _randomInt(1,6); })
            .replace(/{l}/g, () => { return _randomLetterAtoF(); });

        let port = await SmartNodePlugin.findPort(51826);
        
        while (pincode.length < 10) { 
            pincode = pincode.length === 3 || pincode.length === 6 ? pincode + '-' : pincode + _randomInt(0, 9); 
        }
        
        return {
            port,
            username,
            pincode
        }
    }

    async function _fixTemperature(v) {
        // temperatureDisplayUnits is 1 if Fahrenheit
        if (!!(await storage.get('temperatureDisplayUnits'))) {
            v = _CtoV(v);
        }

        return v;
    }
}

function _randomLetterAtoF() {
    return ['A', 'B', 'C', 'D', 'E', 'F'][_randomInt(0, 5)];
}

function _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _CtoF(v) {
    return v * 1.8 + 32;
}

function _FtoC(v) {
    return (v - 32) / 1.8;
}
