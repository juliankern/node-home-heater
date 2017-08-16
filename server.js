const pkg = require('./package.json');
const moment = require('moment');
const utils = global.req('util');

const SmartNodeHomeKit = global.req('classes/SmartNodeHomeKit.class');

// const HomeKit = global.req('lib/homekit.js');
// const uuid = HomeKit.uuid.generate(`homekit:${pkg.name}`);

module.exports = async (SmartNodeServerPlugin) => {
    let homekitProperties;
    let nologs = false;

    let config = SmartNodeServerPlugin.config;
    let storage = SmartNodeServerPlugin.storage;
    let socket = SmartNodeServerPlugin.socket;
    
    let thermostat = new SmartNodeHomeKit({ 
        id: pkg.name, 
        deviceName: `Thermostat ${config.room}`,
        model: pkg.name,
        service: 'Thermostat',
        serial: 'A0000001',
        manufacturer: 'juliankern.com'
    });
    
    SmartNodeServerPlugin.globals.room = [
        'temperature.current',
        'temperature.target',
        'temperature.unit',
        'heater.current',
        'heater.target'
    ];
    
    if (storage.get('homekit-properties')) {
        homekitProperties = storage.get('homekit-properties');
    } else {
        homekitProperties = await generateHomekitProperties();
    }

    SmartNodeServerPlugin.addDisplayData('homekit', {
        description: "HomeKit pincode",
        type: "string",
        value: homekitProperties.pincode
    });

    // SmartNodeServerPlugin.on('globalsChanged', (changed) => {
    //     console.log('Globals have changed, update?!', changed);
    // })
    
    if (!storage.get('temperatureLogs')) {
        storage.set('temperatureLogs', []);
        nologs = true;
    }
    
    SmartNodeServerPlugin.setGlobals({}, {
        temperature: {
            current: _fixTemperatureOut(storage.get('currentTemperature')),
            target: _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')),
            unit: !!storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
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
        if (moment().diff(moment(storage.get('targetHeatingCoolingStateTime')), 'minutes', true) > 120) {
            _setHomeKitState('targetHeatingCoolingState', 'TargetHeatingCoolingState', SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }
        
        if (storage.get('targetHeatingCoolingState') === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.COOL) {
            _setHomeKitState('targetHeatingCoolingState', 'TargetHeatingCoolingState', SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }
        
        if (storage.get('targetHeatingCoolingState') === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.OFF) {
            console.log('targetHeatingCoolingState OFF', storage.get('targetHeatingCoolingState'))
            return _heater(false);
        }

        if (storage.get('targetHeatingCoolingState') === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.HEAT) {
            console.log('targetHeatingCoolingState HEAT', storage.get('targetHeatingCoolingState'))
            return _heater(true);
        }

        // Don't handle TargetHeatingCoolingState.COOL because we're already pretty cool ;-)
        // Don't handle TargetHeatingCoolingState.AUTO explicitly, because everthing below here is AUTO
        
        if (storage.get('currentTemperature') < storage.get('targetTemperature')) {
            console.log('currentTemperature < targetTemperature', storage.get('currentTemperature'), '<', storage.get('targetTemperature'));
            return _heater(true);
        }

        // turn off if nothing matched
        return _heater(false);
    }

    function _heater(status) {
        // handle status here
        if (status) {
            _setHomeKitState('currentHeatingCoolingState', 'CurrentHeatingCoolingState', SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.HEAT);
            socket.emit('on', () => {
                global.warn('Turned heater ON!');
            });
            
            return true;
        }

        _setHomeKitState('currentHeatingCoolingState', 'CurrentHeatingCoolingState', SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
        socket.emit('off', () => {
            global.warn('Turned heater OFF!');
        });
        
        return false;
    }

    function _setHomeKitState(storageKey, HKKey, value) {
        if (storageKey) {
            storage.set(storageKey, value);
        }

        thermostat.set(HKKey, value);
    }

    function load() {
        let logTimer = moment();

        socket.on('temperature', (data) => {
            global.log('SmartNode server got temperature!', data);
            _setHomeKitState('currentTemperature', 'CurrentTemperature', data.value);

            // log every ~15 min or the first log instantly
            if (moment(data.time).diff(logTimer, 'minutes', true) >= 15 || nologs) {
                logTimer = moment();
                nologs = false;

                let logs = storage.get('temperatureLogs');
                logs.push(data);


                // keep logs only 10 days
                if (logs.length > 960) logs.shift();

                storage.set('temperatureLogs', logs);
            }
            
            SmartNodeServerPlugin.setGlobals({}, {
                temperature: {
                    current: _fixTemperatureOut(storage.get('currentTemperature'))
                }
            });

            _checkHeaterStatus();
        });


        thermostat.onIdentify((paired, callback) => {
            if (paired) {
                storage.set('homekit-properties', homekitProperties);
            }
            
            socket.emit('identify', paired, (data) => {
                callback(data.success);
            })
        });

        thermostat.on('get', 'CurrentTemperature', (callback) => {
            global.muted('HK get CurrentTemperature:', storage.get('currentTemperature'), 'fixed:', _fixTemperatureOut(storage.get('currentTemperature')));
            // callback(null, _fixTemperatureOut(storage.get('currentTemperature')));
            callback(null, storage.get('currentTemperature'));
        })

        thermostat.onBoth('TargetTemperature', (callback) => {
            global.muted('HK get TargetTemperature:', storage.get('targetTemperature') || storage.get('currentTemperature'), 'fixed:', _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')));
            // callback(null, _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')));
            callback(null, storage.get('targetTemperature') || storage.get('currentTemperature'));
        }, (value, callback) => {
            global.muted('HK Set TargetTemperature:', value);
            storage.set('targetTemperature', value);

            SmartNodeServerPlugin.setGlobals({}, {
                temperature: {
                    target: _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')),
                }
            });

            _setHomeKitState(null, 'CurrentTemperature', storage.get('currentTemperature'));

            _checkHeaterStatus();

            callback();
        });

        thermostat.onBoth('TemperatureDisplayUnits', (callback) => {
            global.muted('HK get TemperatureDisplayUnits', storage.get('temperatureDisplayUnits') || SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            // callback(null, storage.get('temperatureDisplayUnits') || SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            callback(null, SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
        }, (value, callback) => {
            storage.set('temperatureDisplayUnits', SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            
            // DIABLED for now, as it's not really working yet
            //
            // global.muted('HK set TemperatureDisplayUnits:', value);
            // storage.set('temperatureDisplayUnits', value);

            // SmartNodeServerPlugin.setGlobals({}, {
            //     temperature: {
            //         target: _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')),
            //         current: _fixTemperatureOut(storage.get('currentTemperature')),
            //         unit: storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
            //     }
            // });
            
            // thermostat.getService(HomeKit.Service.Thermostat)
            //     .setCharacteristic(SmartNodeHomeKit.Characteristic.TargetTemperature, _fixTemperatureOut(storage.get('targetTemperature') || storage.get('currentTemperature')));
                
            // thermostat.getService(HomeKit.Service.Thermostat)
            //     .setCharacteristic(SmartNodeHomeKit.Characteristic.CurrentTemperature, _fixTemperatureOut(storage.get('currentTemperature')));

            callback();
        });
        
        thermostat.on('get', 'CurrentHeatingCoolingState', (callback) => {
            global.muted('HK get CurrentHeatingCoolingState:', storage.get('currentHeatingCoolingState') || SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
            callback(null, storage.get('currentHeatingCoolingState') || SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
        });

        thermostat.onBoth('TargetHeatingCoolingState', (callback) => {
            global.muted('HK get TargetHeatingCoolingState:', storage.get('targetHeatingCoolingState') || SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
            callback(null, storage.get('targetHeatingCoolingState') || SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }, (value, callback) => {
            global.muted('HK Set TargetHeatingCoolingState:', value);
            storage.set('targetHeatingCoolingState', value);
            storage.set('targetHeatingCoolingStateTime', +moment());

            SmartNodeServerPlugin.setGlobals({}, {
                heater: {
                    target: storage.get('targetHeatingCoolingState')
                }
            });

            _checkHeaterStatus();
            
            callback();
        });
        
        thermostat.publish(homekitProperties);
        
        global.muted(`Published HomeKit ${pkg.name} with properties:`, homekitProperties);
    }

    function unload() {
        thermostat.destroy();
        socket.removeAllListeners('temperature');
        SmartNodeServerPlugin.removeAllListeners('globalsChanged');
    }

    async function generateHomekitProperties() {
        let pincode = '';
        let username = '{l}{l}:{i}{i}:{i}{l}:{l}{i}:{l}{l}:{l}{i}'
            .replace(/{i}/g, () => { return utils.randomInt(1,6); })
            .replace(/{l}/g, () => { return _randomLetterAtoF(); });

        let port = await utils.findPort(51826);
        
        while (pincode.length < 10) { 
            pincode = pincode.length === 3 || pincode.length === 6 ? pincode + '-' : pincode + utils.randomInt(0, 9); 
        }
        
        return {
            port,
            username,
            pincode
        }
    }

    function _fixTemperatureOut(v) {
        v = +v; // make sure its a number
        
        // temperatureDisplayUnits is 1 if Fahrenheit
        if (storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
            v = _CtoF(v);
        }

        return Math.round(v * 10) / 10;
    }
    
    function _fixTemperatureIn(v) {
        v = +v; // make sure its a number
        
        // temperatureDisplayUnits is 1 if Fahrenheit
        if (storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
            v = _FtoC(v);
        }

        return Math.round(v * 10) / 10;
    }

    function _updateGlobals() {
        SmartNodeServerPlugin.setGlobals(null, {
            temperature: {
                current: _fixTemperatureOut(storage.get('currentTemperature')),
                target: _fixTemperatureOut(storage.get('targetTemperature')  || storage.get('currentTemperature')),
                unit: !!storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
            },
            heaterState: {
                current: storage.get('currentHeatingCoolingState'),
                target: storage.get('targetHeatingCoolingState')
            }
        });
    }
}

function _randomLetterAtoF() {
    return ['A', 'B', 'C', 'D', 'E', 'F'][utils.randomInt(0, 5)];
}

function _CtoF(v) {
    return v * 1.8 + 32;
}

function _FtoC(v) {
    return (v - 32) / 1.8;
}

