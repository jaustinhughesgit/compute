// routes/modules/get.js
"use strict";

/** Capability: action === "get"
 *  Loads the tree via convertToJSON and attaches tasks.
 */
module.exports.register = ({ on, use }) => {
  on("get", async (ctx, { cookie }) => {
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

    return { ok: true, response: mainObj };
  });
};
