async function processConfig(config, initialContext, lib) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules, lib)) {
        let newPath = await installModule(value, context, lib);
    }
    return context;
}

async function installModule(moduleName, context, lib) {
    const npmConfigArgs = Object.entries({cache: '/tmp/.npm-cache',prefix: '/tmp',}).map(([key, value]) => `--${key}=${value}`).join(' ');
    await lib.exec(`npm install ${moduleName} ${npmConfigArgs}`); 
    return "/tmp/node_modules/"+moduleName
}

module.exports = {
    processConfig
};
