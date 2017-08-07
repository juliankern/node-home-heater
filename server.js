const pkg = require('./package.json');
const HomeKit = require('homekit');
const moment = require('moment');

let uuid;
let acce;
let storage;
let config;
let utils;
let homekitProperties;
let nologs = false;

module.exports = async (cfg, tools) => {
    config = cfg;
    utils = tools;
    storage = utils.storage;
    
    if ((await storage.get('homekit-properties'))) {
        homekitProperties = await storage.get('homekit-properties');
    } else {
        homekitProperties = await generateHomekitProperties();
    }
    
    console.log('loaded smartnode-thermostat SERVER');
    
    uuid = HomeKit.uuid.generate(`homekit:${pkg.name}`);

    if (!(await storage.get('temperatureLogs'))) {
        await storage.set('temperatureLogs', []);
        nologs = true;
    }

    return {
        load,
        unload
    }
}

function load(socket) {
    let logTimer = moment();
    socket.on('temperature', async (data) => {
        console.log('SmartNode server got temperature!', data);
        await storage.set('currentTemperature', data);

        // log every ~15 min
        if (moment().diff(logTimer, 'minutes', true) >= 15 || nologs) {
            logTimer = moment();
            nologs = false;

            let logs = await storage.get('temperatureLogs');
            logs.push({ time: +moment(), temperature: data });


            // keep logs only 10 days
            if (logs.length > 960) logs.shift();

            await storage.set('temperatureLogs', logs);
        }
    });

    acce = new HomeKit.Accessory(`Thermostat ${config.room}`, uuid);

    acce.on('identify', (paired, callback) => {
        if (paired) {
            storage.set('homekit-properties', homekitProperties);
        }
        
        socket.emit('identify', paired, (data) => {
            callback(data.success);
        })
    });

    acce.getService(HomeKit.Service.AccessoryInformation)
        .setCharacteristic(HomeKit.Characteristic.Manufacturer, 'juliankern.com')
        .setCharacteristic(HomeKit.Characteristic.Model, pkg.name)
        .setCharacteristic(HomeKit.Characteristic.SerialNumber, 'A0000001');

    acce.addService(HomeKit.Service.Thermostat, `Thermostat ${config.room}`)
        .getCharacteristic(HomeKit.Characteristic.CurrentTemperature)
        .on('get', async (callback) => {
            global.muted('HK get CurrentTemperature:', (await storage.get('currentTemperature')), 1, typeof callback);
            callback(null, (await storage.get('currentTemperature')));
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
        .on('get', async (callback) => {
            global.muted('HK get TargetTemperature:', (await storage.get('targetTemperature')) || (await storage.get('currentTemperature')), 2, typeof callback);
            callback(null, (await storage.get('targetTemperature')) || (await storage.get('currentTemperature')));
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TargetTemperature)
        .on('set', async (value, callback) => {
            global.muted('HK Set TargetTemperature:', +value, value, 3, 1, typeof callback);
            await storage.set('targetTemperature', +value);
            callback();
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
        .on('get', async (callback) => {
            global.muted('HK get TemperatureDisplayUnits', 4, typeof callback);
            callback(null, HomeKit.Characteristic.TemperatureDisplayUnits.CELSIUS);
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TemperatureDisplayUnits)
        .on('set', async (value, callback) => {
            global.muted('HK set TemperatureDisplayUnits:', value, 5, typeof callback);
            callback();
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.CurrentHeatingCoolingState)
        .on('get', async (callback) => {
            global.muted('HK get CurrentHeatingCoolingState:', (await storage.get('currentHeatingCoolingState')) || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF, 6, typeof callback);
            callback(null, (await storage.get('currentHeatingCoolingState')) || HomeKit.Characteristic.CurrentHeatingCoolingState.OFF);
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.CurrentHeatingCoolingState)
        .on('set', async (value, callback) => {
            global.muted('HK Set CurrentHeatingCoolingState:', value, 7, typeof callback);
            await storage.set('currentHeatingCoolingState', value);
            callback();
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
        .on('get', async (callback) => {
            global.muted('HK get TargetHeatingCoolingState:', (await storage.get('targetHeatingCoolingState')) || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO, 8, typeof callback);
            callback(null, (await storage.get('targetHeatingCoolingState')) || HomeKit.Characteristic.TargetHeatingCoolingState.AUTO);
        })
    ;
    
    acce.getService(HomeKit.Service.Thermostat)
        .getCharacteristic(HomeKit.Characteristic.TargetHeatingCoolingState)
        .on('set', async (value, callback) => {
            global.muted('HK Set TargetHeatingCoolingState:', value, 9, typeof callback);
            await storage.set('targetHeatingCoolingState', value);
            callback();
        })
    ;
    
    acce.publish(homekitProperties);
    
    global.muted(`Published HomeKit ${pkg.name} with properties:`, homekitProperties);
}

function unload(socket) {
    acce.destroy();
}

async function generateHomekitProperties() {
    let pincode = '';
    let username = 'CC:{i}{i}:{i}D:E{i}:CE:F{i}'.replace(/{i}/g, () => { return _randomInt(1,6); });
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

function _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

