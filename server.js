const HomeKit = require('homekit');
const moment = require('moment');

let uuid;
let acce;
let storage;
let config;

module.exports = async (cfg, store) => {
    config = cfg;
    storage = store;
    console.log('loaded node-home-heater SERVER');
    
    uuid = HomeKit.uuid.generate('homekit:node-home-heater');

    try {
        await storage.getItem(`${config.room}.temperatureLogs`);
    } catch(e) {
        await storage.setItem(`${config.room}.temperatureLogs`, []);
    }

    return {
        load,
        unload
    }
}

function load(socket) {
    socket.on('temperature', async (data) => {
        console.log('node-home server got temperature!', data);
        await storage.setItem(`${config.room}.currentTemperature`, data);

        let logs = await storage.getItem(`${config.room}.temperatureLogs`);
        logs.push({ time: +moment(), temperature: data });
        await storage.setItem(`${config.room}.temperatureLogs`, logs);
    });

    acce = new HomeKit.Accessory(`Heater ${config.room}`, uuid);

    acce.on('identify', (paired, callback) => {
        socket.emit('identify', paired, (data) => {
            callback(data.success);
        })
    });

    acce
        .addService(HomeKit.Service.Thermostat, `Heater ${config.room}`)
        .getCharacteristic(HomeKit.Characteristic.CurrentTemperature)
        .on('get', async (callback) => {
            callback((await storage.getItem(`${config.room}.currentTemperature`)));
        })
    ;
}

function unload(socket) {

}