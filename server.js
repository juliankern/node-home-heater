const pkg = require('./package.json');
const moment = require('moment');
const utils = global.req('util');

const SmartNodeHomeKit = global.req('classes/HomeKit.class');

// const HomeKit = global.req('lib/homekit.js');
// const uuid = HomeKit.uuid.generate(`homekit:${pkg.name}`);

module.exports = async (SmartNodeServerPlugin) => {
    let homekitProperties;
    let nologs = false;
    let thermostat;

    let config = SmartNodeServerPlugin.config;
    let storage = SmartNodeServerPlugin.storage;
    let socket = SmartNodeServerPlugin.socket;

    return {
        load,
        unload,
        unpair
    }

    async function init() {
        thermostat = new SmartNodeHomeKit({
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

        ///////////////////////////////////////////////////////////////////

        if ((await storage.get('homekit-properties'))) {
            homekitProperties = await storage.get('homekit-properties');
        } else {
            homekitProperties = await generateHomekitProperties();
        }

        if (!(await storage.get('targetTemperature'))) {
            await storage.set('targetTemperature', 20);
        }

        ///////////////////////////////////////////////////////////////////

        SmartNodeServerPlugin.addDisplayData('currentTemperature', {
            description: "Current temperature",
            type: "string",
            value: await _getTemp('currentTemperature', true, 'both')
        });


        SmartNodeServerPlugin.addDisplayData('targetTemperature', {
            description: "Target temperature",
            type: "string",
            value: await _getTemp('targetTemperature', true, 'both')
        });

        SmartNodeServerPlugin.addDisplayData('currentHeatingCoolingState', {
            description: "Heater on",
            type: "boolean",
            value: (await storage.get('targetHeatingCoolingState')) === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.HEAT
        });

        SmartNodeServerPlugin.addDisplayData('homekit', {
            description: "HomeKit pincode",
            type: "homekitpin",
            value: homekitProperties.pincode
        });

        ///////////////////////////////////////////////////////////////////

        // SmartNodeServerPlugin.on('globalsChanged', (changed) => {
        //     console.log('Globals have changed, update?!', changed);
        // })

        if (!(await storage.get('temperatureLogs'))) {
            await storage.set('temperatureLogs', []);
            nologs = true;
        }

        SmartNodeServerPlugin.setGlobals({}, {
            temperature: {
                current: await _getTemp('currentTemperature', true, true),
                target: await _getTemp('targetTemperature', true, true),
                unit: !!(await storage.get('temperatureDisplayUnits')) === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
            },
            heater: {
                current: await storage.get('currentHeatingCoolingState'),
                target: await storage.get('targetHeatingCoolingState')
            }
        });
    }

    function unload() {
        thermostat.destroy();
        socket.removeAllListeners('temperature');
        SmartNodeServerPlugin.removeAllListeners('globalsChanged');
        SmartNodeServerPlugin.removeGlobals();
        SmartNodeServerPlugin.removeAllDisplayData();
    }

    async function unpair() {
        await storage.set('homekit-properties', undefined);
        await storage.set('targetTemperature', undefined);
    }

    async function load() {
        await init();

        let logTimer = moment();

        socket.on('temperature', async (data) => {
            global.log('SmartNode server got temperature!', data);
            _setHomeKitState('currentTemperature', 'CurrentTemperature', data.value);

            // log every ~15 min or the first log instantly
            if (moment(data.time).diff(logTimer, 'minutes', true) >= 15 || nologs) {
                logTimer = moment();
                nologs = false;

                let logs = await storage.get('temperatureLogs');
                logs.push(data);


                // keep logs only 10 days
                if (logs.length > 960) logs.shift();

                await storage.set('temperatureLogs', logs);
            }

            SmartNodeServerPlugin.setGlobals({}, {
                temperature: {
                    current: await _getTemp('currentTemperature', true, true)
                }
            });

            SmartNodeServerPlugin.updateDisplayData('currentTemperature', {
                value: await _getTemp('currentTemperature', true, 'both')
            });

            await _checkHeaterStatus();
        });


        thermostat.onIdentify(async (paired, callback) => {
            if (paired) {
                await storage.set('homekit-properties', homekitProperties);
            }

            socket.emit('identify', paired, (data) => {
                callback(data.success);
            })
        });

        thermostat.on('get', 'CurrentTemperature', async (callback) => {
            global.muted('HK get CurrentTemperature:', await storage.get('currentTemperature'), 'fixed:', await _getTemp('currentTemperature', true));
            // callback(null, _fixTemperatureOut(storage.get('currentTemperature')));
            callback(null, await storage.get('currentTemperature'));
        })

        thermostat.onBoth('TargetTemperature', async (callback) => {
            global.muted('HK get TargetTemperature:', storage.get('targetTemperature'), 'fixed:', await _getTemp('targetTemperature', true));
            // callback(null, _fixTemperatureOut(await storage.get('targetTemperature')));
            callback(null, await storage.get('targetTemperature'));
        }, async (value, callback) => {
            global.muted('HK Set TargetTemperature:', value);
            await storage.set('targetTemperature', value);

            SmartNodeServerPlugin.setGlobals({}, {
                temperature: {
                    target: await _getTemp('targetTemperature', true, true),
                }
            });

            SmartNodeServerPlugin.updateDisplayData('targetTemperature', {
                value: await _getTemp('targetTemperature', true, 'both')
            });

            _setHomeKitState(null, 'TargetTemperature', await storage.get('targetTemperature'));

            await _checkHeaterStatus();

            callback();
        });

        thermostat.onBoth('TemperatureDisplayUnits', async (callback) => {
            global.muted('HK get TemperatureDisplayUnits', await storage.get('temperatureDisplayUnits') || SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            // callback(null, await storage.get('temperatureDisplayUnits') || SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
            callback(null, SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
        }, async (value, callback) => {
            await storage.set('temperatureDisplayUnits', SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);

            // DIABLED for now, as it's not really working yet
            //
            // global.muted('HK set TemperatureDisplayUnits:', value);
            // await storage.set('temperatureDisplayUnits', value);

            // SmartNodeServerPlugin.setGlobals({}, {
            //     temperature: {
            //         target: _fixTemperatureOut(await storage.get('targetTemperature')),
            //         current: _fixTemperatureOut((await storage.get('currentTemperature'))),
            //         unit: await storage.get('temperatureDisplayUnits') === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
            //     }
            // });

            // thermostat.getService(HomeKit.Service.Thermostat)
            //     .setCharacteristic(SmartNodeHomeKit.Characteristic.TargetTemperature, _fixTemperatureOut(await storage.get('targetTemperature')));

            // thermostat.getService(HomeKit.Service.Thermostat)
            //     .setCharacteristic(SmartNodeHomeKit.Characteristic.CurrentTemperature, _fixTemperatureOut((await storage.get('currentTemperature'))));

            callback();
        });

        thermostat.on('get', 'CurrentHeatingCoolingState', async (callback) => {
            global.muted('HK get CurrentHeatingCoolingState:', await storage.get('currentHeatingCoolingState') || SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
            callback(null, await storage.get('currentHeatingCoolingState') || SmartNodeHomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
        });

        thermostat.onBoth('TargetHeatingCoolingState', async (callback) => {
            global.muted('HK get TargetHeatingCoolingState:', await storage.get('targetHeatingCoolingState') || SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
            callback(null, await storage.get('targetHeatingCoolingState') || SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }, async (value, callback) => {
            global.muted('HK Set TargetHeatingCoolingState:', value);
            await storage.set('targetHeatingCoolingState', value);
            await storage.set('targetHeatingCoolingStateTime', +moment());

            SmartNodeServerPlugin.setGlobals({}, {
                heater: {
                    target: await storage.get('targetHeatingCoolingState')
                }
            });

            await _checkHeaterStatus();

            callback();
        });

        thermostat.publish(homekitProperties);

        global.muted(`Published HomeKit ${pkg.name} with properties:`, homekitProperties);
    }

    async function _checkHeaterStatus() {
        if (moment().diff(moment(await storage.get('targetHeatingCoolingStateTime')), 'minutes', true) > 120) {
            _setHomeKitState('targetHeatingCoolingState', 'TargetHeatingCoolingState', SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }

        if ((await storage.get('targetHeatingCoolingState')) === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.COOL) {
            _setHomeKitState('targetHeatingCoolingState', 'TargetHeatingCoolingState', SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        }

        if ((await storage.get('targetHeatingCoolingState')) === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.OFF) {
            console.log('targetHeatingCoolingState OFF', await storage.get('targetHeatingCoolingState'))
            return _heater(false);
        }

        if ((await storage.get('targetHeatingCoolingState')) === SmartNodeHomeKit.Characteristic.TargetHeatingCoolingState.HEAT) {
            console.log('targetHeatingCoolingState HEAT', await storage.get('targetHeatingCoolingState'))
            return _heater(true);
        }

        // Don't handle TargetHeatingCoolingState.COOL because we're already pretty cool ;-)
        // Don't handle TargetHeatingCoolingState.AUTO explicitly, because everthing below here is AUTO

        if ((await storage.get('currentTemperature')) < (await storage.get('targetTemperature'))) {
            console.log('currentTemperature < targetTemperature', await storage.get('currentTemperature'), '<', await storage.get('targetTemperature'));
            return _heater(true);
        }

        // turn off if nothing matched
        return _heater(false);
    }

    function _heater(status) {
        SmartNodeServerPlugin.updateDisplayData('currentHeatingCoolingState', {
            value: status
        });

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

    async function _setHomeKitState(storageKey, HKKey, value) {
        if (storageKey) {
            await storage.set(storageKey, value);
        }

        thermostat.set(HKKey, value);
    }

    async function getUnit() {
        return (!!(await storage.get('temperatureDisplayUnits')) === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C');
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

    async function _getTemp(field = 'currentTemperature', fix, addSymbols = false) {
        let temp = await storage.get(field);

        if (fix === 'in') {
            temp = _FtoC(temp);
        } else if(fix) {
            temp = _CtoF(temp);
        }

        if (addSymbols === 'both') {
            temp = temp.toFixed(1) + '°' + await getUnit();
        } else if(addSymbols) {
            temp = temp.toFixed(1);
        }

        return temp;
    }

    async function _fixTemperatureOut(v) {
        v = +v || 0; // make sure its a number

        // temperatureDisplayUnits is 1 if Fahrenheit
        if ((await storage.get('temperatureDisplayUnits')) === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
            v = _CtoF(v);
        }

        return Math.round(v * 10) / 10;
    }

    async function _fixTemperatureIn(v) {
        v = +v || 0; // make sure its a number

        // temperatureDisplayUnits is 1 if Fahrenheit
        if ((await storage.get('temperatureDisplayUnits')) === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
            v = _FtoC(v);
        }

        return Math.round(v * 10) / 10;
    }

    async function _updateGlobals() {
        SmartNodeServerPlugin.setGlobals(null, {
            temperature: {
                current: await _getTemp('currentTemperature', true),
                target: await _fixTemperatureOut(await storage.get('targetTemperature')  || (await storage.get('currentTemperature'))),
                unit: !!(await storage.get('temperatureDisplayUnits')) === SmartNodeHomeKit.Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C'
            },
            heaterState: {
                current: await storage.get('currentHeatingCoolingState'),
                target: await storage.get('targetHeatingCoolingState')
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

