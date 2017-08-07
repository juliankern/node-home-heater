let gpio;

try {
    gpio = require('rpi-gpio');
} catch(e) {
    gpio = { 
        DIR_HIGH: 'high',
        setup: (chan, mode, cb) => { global.muted(`Setup GPIO ${chan} for mode ${mode}`); cb(); },
        on: () => {},
        destroy: () => {},
        write: (chan, value) => { global.muted(`Set GPIO ${chan} to value ${value}`); }
    }
}

module.exports = gpio;