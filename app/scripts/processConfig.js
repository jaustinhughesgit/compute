async function processConfig(config, initialContext) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function downloadAndPrepareModule(moduleName, context) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!lib.fs.existsSync(modulePath)) {
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
    return modulePath;
}

async function downloadAndUnzipModuleFromS3(moduleName, modulePath) {
    const zipKey = `node_modules/${moduleName}.zip`;
    const params = {
        Bucket: "1var-node-modules",
        Key: zipKey,
    };
    try {
        const data = await lib.s3.getObject(params).promise();
        await unzipModule(data.Body, modulePath);
    } catch (error) {
        console.error(`Error downloading and unzipping module ${moduleName}:`, error);
        throw error;
    }
}

async function unzipModule(zipBuffer, modulePath) {
    lib.fs.mkdirSync(modulePath, { recursive: true });
    const directory = await lib.unzipper.Open.buffer(zipBuffer);
    await directory.extract({ path: modulePath });
}