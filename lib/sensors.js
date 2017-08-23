const util = global.req('util');

module.exports = (model) => {
    let sensor; 

    switch (model) {
        case 'ds1820':
            try {
                if (process.platform === 'darwin') throw 'Wrong platform';
                sensor = require('ds1820-temp');
            } catch(e) {
                sensor = { 
                    readDevice: async () => {
                        return new Promise((resolve, reject) => {  resolve({ value: (util.randomInt(180, 225) / 10) }); });
                    }
                }
            }
        break;
    }

    return sensor;
}