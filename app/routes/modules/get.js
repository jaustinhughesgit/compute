// routes/modules/get.js
"use strict";

module.exports.register = ({ on, use }) => {
  on("get", async (ctx, { cookie }) => {
    console.log("get1")
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;

    const convertToJSON = use("convertToJSON");
    const getTasks      = use("getTasks");
    const getTasksIOS   = use("getTasksIOS");

    const fileID = (ctx.path || "").split("/")[3];

    const mainObj = await convertToJSON(
      fileID, [], null, null,
      cookie, dynamodb, uuidv4,
      null, [], {}, "", dynamodbLL, ctx.req.body
    );

    const tasksUnix = await getTasks(fileID, "su", dynamodb);
    mainObj.tasks   = await getTasksIOS(tasksUnix);
    mainObj.file    = fileID;

    console.log("get2")
    return { ok: true, response: mainObj };
  });
};