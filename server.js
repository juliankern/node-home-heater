const pkg = require('./package.json');
const moment = require('moment');
const utils = global.req('util');

module.exports = async (SmartNodeServerPlugin) => {
    let homekitProperties;
    let nologs = false;
    let thermostat;

    let config = SmartNodeServerPlugin.config;
    let storage = SmartNodeServerPlugin.storage;
    let socket = SmartNodeServerPlugin.socket;
    
    SmartNodeServerPlugin.globals.room = [
        'temperature.current',
        'temperature.target',
        'temperature.unit',
        'heater.current',
        'heater.target'
    ];

    let HomeKit = require('./lib/homekit.js');
    
    if (storage.get('homekit-properties')) {
        homekitProperties = storage.get('homekit-properties');
    } else {
        homekitProperties = await generateHomekitProperties();
    }

    SmartNodeServerPlugin.on('globalsChanged', (changed) => {
        console.log('Globals have changed, update?!', changed);
    })
    
    let uuid = HomeKit.uuid.generate(`homekit:${pkg.name}`);

    if (!storage.get('temperatureLogs')) {
        storage.set('temperatureLogs', []);
        nologs = true;
    }
    
    SmartNodeServerPlugin.setGlobals({}, {
        temperature: {
            current: _fixTemperature(storage.get('currentTemperature')),
            target: _fixTemperature(storage.get('targetTemperature')  || storage.get('currentTemperature')),
            unit: !!storage.get('temperatureDisplayUnits') ? 'F' : 'C'
        },
        heater: {
            current: storage.get('currentHeatingCoolingState'),
            target: storage.get('targetHeatingCoolingState')
        }
    });

    return {
        load,
        unload
    } 
    
    function _checkHeaterStatus() {
        if (storage.get('targetHeatingCoolingState') === HomeKit.Characteristic.TargetHeatingCoolingState.OFF) {
            return _heater(false);
        }

        if (storage.get('targetHeatingCoolingState') === HomeKit.Characteristic.TargetHeatingCoolingState.HEAT) {
            return _heater(true);
        }

        // Don't handle TargetHeatingCoolingState.COOL because we're already pretty cool ;-)
        // Don't handle TargetHeatingCoolingState.AUTO explicitly, because everthing below here is AUTO
        
        if (storage.get('currentTemperature') < storage.get('targetTemperature')) {
            return _heater(true);
        }

        // turn off if nothing matched
        return _heater(false);
    }

    function _heater(status) {
        // handle status here
        if (status) {
            _setHomeKitState('currentHeatingCoolingState', 'CurrentHeatingCoolingState', HomeKit.Characteristic.CurrentHeatingCoolingState.HEAT);
            global.warn('Turned heater ON!');
            return true;
        }

        _setHomeKitState('currentHeatingCoolingState', 'CurrentHeatingCoolingState', HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
        global.warn('Turned heater OFF!');
    }

    function _setHomeKitState(storageKey, HKKey, value) {
        if (storageKey) {
            storage.set(storageKey, value);
        }

        thermostat.getService(HomeKit.Service.Thermostat)
            .setCharacteristic(HomeKit.Characteristic[HKKey], value);
    }

    function load() {
        let logTimer = moment();

        socket.on('temperature', (data) => {
            global.log('SmartNode server got temperature!', data);
            storage.set('currentTemperature', data.value);

            // log every ~15 min or the first log instantly
            if (moment(data.time).diff(logTimer, 'minutes', true) >= 15 || nologs) {
                logTimer = moment();
                nologs = false;

                let logs = storage.get('temperatureLogs');
                logs.push({ time: data.time, value: data });


                // keep logs only 10 days
                if (logs.length > 960) logs.shift();

                storage.set('temperatureLogs', logs);
            }
            
            SmartNodeServerPlugin.setGlobals({}, {
                temperature: {
                    current: _fixTemperature(storage.get('currentTemperature'))
                }
            });

            _checkHeaterStatus();
        });

        thermostat = new HomeKit.Accessory(`Thermostat ${config.room}`, uuid);

        thermostat.on('identify', (paired, callback) => {
            if (paired) {
                storage.set('homekit-properties', homekitProperties);
            }
            
            socket.emit('identify', paired, (data) => {
                callback(data.success);
            })
        });

        thermostat.getService(HomeKit.Service.AccessoryInformation)
            .setCharacteristic(HomeKit.Characteristic.Manufacturer, 'juliankern.com')
            .setCharacteristic(HomeKit.Characteristic.Model, pkg.name)
            .setCharacteristic(HomeKit.Characteristic.SerialNumber, 'A0000001');

        thermostat.addService(HomeKit.Service.Thermostat, `Thermostat ${config.room}`)
            .getCharacteristic(HomeKit.Characteristic.CurrentTemperature)
            .on('get', (callback) => {
                global.muted('HK get CurrentTemperature:', storage.get('currentTemperature'));
                callback(null, storage.get('currentTemperature'));
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
            .on('get', (callback) => {
                global.muted('HK get TargetTemperature:', storage.get('targetTemperature') || storage.get('currentTemperature'));
                callback(null, storage.get('targetTemperature') || storage.get('currentTemperature'));
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
            .on('set', (value, callback) => {
                global.muted('HK Set TargetTemperature:', +value);
                storage.set('targetTemperature', +value);

                SmartNodeServerPlugin.setGlobals({}, {
                    temperature: {
                        target: _fixTemperature(storage.get('targetTemperature')  || storage.get('currentTemperature')),
                    }
                });

                _checkHeaterStatus();

                callback();
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
            .on('get', (callback) => {
                global.muted('HK get TemperatureDisplayUnits', storage.get('temperatureDisplayUnits') || HomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
                callback(null, storage.get('temperatureDisplayUnits') || HomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
            .on('set', (value, callback) => {
                global.muted('HK set TemperatureDisplayUnits:', value);
                storage.set('temperatureDisplayUnits', value);

                SmartNodeServerPlugin.setGlobals({}, {
                    temperature: {
                        unit: !!storage.get('temperatureDisplayUnits') ? 'F' : 'C'
                    }
                });

                callback();
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.CurrentHeatingCoolingState)
            .on('get', (callback) => {
                global.muted('HK get CurrentHeatingCoolingState:', storage.get('currentHeatingCoolingState') || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
                callback(null, storage.get('currentHeatingCoolingState') || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
            .on('get', (callback) => {
                global.muted('HK get TargetHeatingCoolingState:', storage.get('targetHeatingCoolingState') || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
                callback(null, storage.get('targetHeatingCoolingState') || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
            })
        ;
        
        thermostat.getService(HomeKit.Service.Thermostat)
            .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
            .on('set', (value, callback) => {
                global.muted('HK Set TargetHeatingCoolingState:', value);
                storage.set('targetHeatingCoolingState', value);

                SmartNodeServerPlugin.setGlobals({}, {
                    heater: {
                        target: storage.get('targetHeatingCoolingState')
                    }
                });

                _checkHeaterStatus();
                
                callback();
            })
        ;
        
        thermostat.publish(homekitProperties);
        
        global.muted(`Published HomeKit ${pkg.name} with properties:`, homekitProperties);
    }

    function unload() {
        thermostat.destroy();
        socket.removeAllListeners('temperature');
        SmartNodePlugin.removeAllListeners('globalsChanged');
    }

    async function generateHomekitProperties() {
        let pincode = '';
        let username = '{l}{l}:{i}{i}:{i}{l}:{l}{i}:{l}{l}:{l}{i}'
            .replace(/{i}/g, () => { return _randomInt(1,6); })
            .replace(/{l}/g, () => { return _randomLetterAtoF(); });

        let port = await utils.findPort(51826);
        
        while (pincode.length < 10) { 
            pincode = pincode.length === 3 || pincode.length === 6 ? pincode + '-' : pincode + _randomInt(0, 9); 
        }
        
        return {
            port,
            username,
            pincode
        }
    }

    function _fixTemperature(v) {
        // temperatureDisplayUnits is 1 if Fahrenheit
        if (!!storage.get('temperatureDisplayUnits')) {
            v = _CtoF(v);
        }

        return v.toFixed(1);
    }

    function _updateGlobals() {
        SmartNodeServerPlugin.setGlobals(null, {
            temperature: {
                current: _fixTemperature(storage.get('currentTemperature')),
                target: _fixTemperature(storage.get('targetTemperature')  || storage.get('currentTemperature')),
                unit: !!storage.get('temperatureDisplayUnits') ? 'F' : 'C'
            },
            heaterState: {
                current: storage.get('currentHeatingCoolingState'),
                target: storage.get('targetHeatingCoolingState')
            }
        });
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

