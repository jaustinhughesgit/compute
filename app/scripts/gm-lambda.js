const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

function gmLambda(inputFile) {
  return {
    write: async (outputFile) => {
      await execFileAsync('/opt/graphicsmagick-layer/bin/gm', [
        'convert',
        inputFile,
        outputFile,
      ]);
    },
  };
}

module.exports = gmLambda;