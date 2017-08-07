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
                        return new Promise((resolve, reject) => {  resolve({ value: 21.2 }); });
                    }
                }
            }
        break;
    }

    return sensor;
}