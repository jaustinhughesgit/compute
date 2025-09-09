// routes/modules/get.js
"use strict";

module.exports.register = ({ on, use }) => {
  on("get", async (ctx, { cookie }) => {
    console.log("get1")
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;

    const convertToJSON = use("convertToJSON");
    const getTasks      = use("getTasks");
    const getTasksIOS   = use("getTasksIOS");

   const parts = String(ctx.path || "").split("/").filter(Boolean);
   // Support both normalized tail "/<id>..." and legacy "/cookies/get/<id>..."
   const fileID = parts[0] || parts[2] || null;

   if (!fileID) {
     console.error("Missing fileID in ctx.path", { path: ctx.path });
     return { ok: false, error: "Missing file ID in path" };
   }

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