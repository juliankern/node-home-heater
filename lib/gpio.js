let gpio;

try {
    gpio = require('rpi-gpio');
} catch(e) {
    gpio = { 
        setup: (chan, mode, cb) => { cb(); },
        on: () => {},
        destroy: () => {},
        write: () => {}
    }
}

module.exports = gpio;