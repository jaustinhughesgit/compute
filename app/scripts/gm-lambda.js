const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

function imLambda(inputFile) {
  return {
    write: async (outputFile) => {
      await execFileAsync('/opt/imagemagick/bin/magick', [
        'convert',
        inputFile,
        outputFile,
      ]);
    },
  };
}

module.exports = imLambda;