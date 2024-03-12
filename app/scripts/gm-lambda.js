const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

function gmLambda(inputFile) {
  return {
    write: async (outputFile) => {
      await execFileAsync('/opt/var/task/graphicsmagick/bin/gm', [
        'convert',
        inputFile,
        outputFile,
      ]);
    },
  };
}

module.exports = gmLambda;