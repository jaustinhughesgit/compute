//routes/modules/file.js
/** Capabilities:
 *   - action === "file"   → signed CloudFront access (cookies or URL)
 *   - action === "reqPut" → S3 PUT pre-sign
 */
module.exports.register = ({ on, use }) => {
  on('file', async (ctx, { cookie }) => {
    const { dynamodb } = ctx.deps;
    const signer = ctx.signer;

    const convertToJSON = use('convertToJSON');
    const getTasks      = use('getTasks');
    const getTasksIOS   = use('getTasksIOS');
    const fileLocation  = use('fileLocation');
    const sendBack      = use('sendBack');

    const fileID = ctx.path.split('/')[3];

    const mainObj = await convertToJSON(
      fileID, [], null, null,
      cookie, dynamodb, ctx.deps.uuidv4,
      null, [], {}, '', ctx.deps.dynamodbLL, ctx.req.body
    );
    const tasksUnix = await getTasks(fileID, 'su', dynamodb);
    mainObj.tasks   = await getTasksIOS(tasksUnix);
    mainObj.file    = fileID;

    // Signed CloudFront logic
    const expires = 90_000;
    const url = `https://${fileLocation(true)}.1var.com/${fileID}`;

    const policy = JSON.stringify({
      Statement: [{
        Resource: url,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires)/1000) }
        }
      }]
    });

    if (ctx.type === 'url') {
      const signedUrl = signer.getSignedUrl({ url, policy });
      sendBack(ctx.res, 'json', { signedUrl }, false);
      return { __handled: true };
    }

    const cookies = signer.getSignedCookie({ policy });
    Object.entries(cookies).forEach(([name, val]) => {
      ctx.res.cookie(name, val, {
        maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None'
      });
    });

    sendBack(ctx.res, 'json', { ok: true, response: mainObj }, false);
    return { __handled: true };
  });

  on('reqPut', async (ctx) => {
    const { s3, dynamodb } = ctx.deps;
    const sendBack     = use('sendBack');
    const fileLocation = use('fileLocation');
    const getSub       = use('getSub');

    const parts        = ctx.path.split('/');
    const fileID       = parts[3];
    const fileCategory = parts[4];
    const fileType     = parts[5];

    const subBySU  = await getSub(fileID, 'su', dynamodb);
    const isPublic = subBySU.Items?.[0]?.z;
    const bucket   = `${fileLocation(isPublic)}.1var.com`;
    const expires  = 90_000;

    const params = {
      Bucket: bucket,
      Key: fileID,
      Expires: expires,
      ContentType: `${fileCategory}/${fileType}`
    };

    const url = await new Promise((resolve, reject) =>
      s3.getSignedUrl('putObject', params, (e, u) => e ? reject(e) : resolve(u))
    );

    sendBack(ctx.res, 'json', { ok: true, response: { putURL: url } }, false);
    return { __handled: true };
  });
};
