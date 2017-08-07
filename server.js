// const HomeKit = require('homekit');
const moment = require('moment');

let uuid;
let acce;
let storage;
let config;

module.exports = async (cfg, deps) => {
    config = cfg;
    storage = deps.storage;
    console.log('loaded smartnode-thermostat SERVER');
    
    // uuid = HomeKit.uuid.generate('homekit:node-home-heater');

    if (!(await storage.get('temperatureLogs'))) {
        await storage.set('temperatureLogs', []);
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
        if (logTimer.diff(moment(), 'minutes', true) >= 15) {
            logTimer = moment();

            let logs = await storage.get('temperatureLogs');
            logs.push({ time: +moment(), temperature: data });


            // keep logs only 10 days
            if (logs.length > 960) logs.shift();

            await storage.set('temperatureLogs', logs);
        }
    });

    // acce = new HomeKit.Accessory(`Heater ${config.room}`, uuid);

    // acce.on('identify', (paired, callback) => {
    //     socket.emit('identify', paired, (data) => {
    //         callback(data.success);
    //     })
    // });

    // acce
    //     .addService(HomeKit.Service.Thermostat, `Heater ${config.room}`)
    //     .getCharacteristic(HomeKit.Characteristic.CurrentTemperature)
    //     .on('get', async (callback) => {
    //         callback((await storage.getItem(`${config.room}.currentTemperature`)));
    //     })
    // ;
}

function unload(socket) {

}