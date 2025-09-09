//routes/modules/groups.js
/** Capabilities:
 *  - action === "newGroup"
 *  - action === "useGroup"
 *  - action === "substituteGroup"
 */
module.exports.register = ({ on, use }) => {
  on('newGroup', async (ctx, { cookie }) => {
    console.log("ctx",ctx)
    const { dynamodb, uuidv4, s3, ses, dynamodbLL } = ctx.deps;

    const increment = use('incrementCounterAndGetNewValue');
    const createWord = use('createWord');
    const createGroup = use('createGroup');
    const createAccess = use('createAccess');
    const createVerified = use('createVerified');
    const createSubdomain = use('createSubdomain');
    const addVersion = use('addVersion');
    const createEntity = use('createEntity');
    const createFile = use('createFile');
    const getUUID = use('getUUID');
    const convertToJSON = use('convertToJSON');
    const email = use('email');

const parts = ctx.path.split('/'); // e.g. "/module2/module2/abc"
const [, newGroupName, headEntityName, headUUIDToShow] = parts;

if (!newGroupName || !headEntityName) {
  throw new Error(`newGroup expects "/<name>/<head>/<uuid?>", got "${ctx.path}"`);
}


    console.log("parts",parts)
    console.log("newGroupName",newGroupName)
    console.log("headEntityName",headEntityName)
    console.log("headUUIDToShow",headUUIDToShow)

    // Words & ids
    const aNewG = await increment('wCounter', dynamodb);
    const aG    = await createWord(aNewG.toString(), newGroupName, dynamodb);

    const aNewE = await increment('wCounter', dynamodb);
    const aE    = await createWord(aNewE.toString(), headEntityName, dynamodb);

    const gNew  = await increment('gCounter', dynamodb);
    const eNew  = await increment('eCounter', dynamodb);
    const ai    = await increment('aiCounter', dynamodb);

    // Access + verified
    await createAccess(ai.toString(), gNew.toString(), '0', { count: 1, metric: 'year' }, 10, { count: 1, metric: 'minute' }, {}, 'rwado');

    const ttlSeconds = 90_000;
    const exUnix     = Math.floor(Date.now()/1000) + ttlSeconds;
    const vi         = await increment('viCounter', dynamodb);
    await createVerified(vi.toString(), cookie.gi.toString(), gNew.toString(), '0', ai.toString(), '0', exUnix, true, 0, 0);

    // Create group + head entity + subs
    await createGroup(gNew.toString(), aG, eNew.toString(), [ai.toString()], dynamodb);

    const suRoot = await getUUID(uuidv4);
    await createSubdomain(suRoot, '0', '0', gNew.toString(), true, dynamodb);

    const vHead = await addVersion(eNew.toString(), 'a', aE.toString(), null, dynamodb);
    await createEntity(eNew.toString(), aE.toString(), vHead.v, gNew.toString(), eNew.toString(), [ai.toString()], dynamodb);

    const suDoc = await getUUID(uuidv4);
    const payload = {
      input: [],
      published: {
        blocks:   [{ entity: suDoc, name: 'Primary' }],
        modules:  {},
        actions:  [{ target: '{|res|}!', chain: [{ access: 'send', params: [ctx.req.body?.output] }], assign: '{|send|}' }],
        function: {},
        automation: [],
        menu: {
          ready: {
            _name: 'Ready', _classes: ['Root'], _show: false, _selected: true,
            options: { _name: 'Options', _classes: ['ready'], _show: true, _selected: false, back: { _name: 'Back', _classes: ['options'], _show: false, _selected: false } },
            close:   { _name: 'Close', _classes: ['ready'], _show: false, _selected: false }
          }
        },
        commands: {
          ready:   { call: 'ready',   ready: false, updateSpeechAt: true, timeOut: 0 },
          back:    { call: 'back',    ready: true,  updateSpeechAt: true, timeOut: 0 },
          close:   { call: 'close',   ready: false, updateSpeechAt: true, timeOut: 0 },
          options: { call: 'options', ready: false, updateSpeechAt: true, timeOut: 0 }
        },
        calls: {
          ready:   [{ if: [{ key: ['ready','_selected'], expression: '==', value: true }], then: ['ready'], show: ['ready'], run: [{ function: 'show', args: ['menu', 0], custom: false }] }],
          back:    [{ if: [{ key: ['ready','_selected'], expression: '!=', value: true }], then: ['ready'], show: ['ready'], run: [{ function: 'highlight', args: ['ready', 0], custom: false }] }],
          close:   [{ if: [], then: ['ready'], show: [], run: [{ function: 'hide', args: ['menu', 0] }] }],
          options: [{ if: [{ key: ['ready','_selected'], expression: '==', value: true }], then: ['ready','options'], show: ['options'], run: [] }]
        },
        templates: {
          init:   { '1': { rows: { '1': { cols: ['a','b'] } } } },
          second: { '2': { rows: { '1': { cols: ['c','d'] } } } }
        },
        assignments: {
          a: { _editable: false, _movement: 'move', _owners: [], _modes: { _html: 'Box 1' }, _mode: '_html' },
          b: { _editable: false, _movement: 'move', _owners: [], _modes: { _html: 'Box 2' }, _mode: '_html' },
          c: { _editable: false, _movement: 'move', _owners: [], _modes: { _html: 'Box 3' }, _mode: '_html' },
          d: { _editable: false, _movement: 'move', _owners: [], _modes: { _html: 'Box 4' }, _mode: '_html' }
        },
        mindsets: [],
        thoughts: {},
        moods: []
      },
      skip: [], sweeps: 1, expected: []
    };

    await createSubdomain(suDoc, aE.toString(), eNew.toString(), '0', true, dynamodb);
    await createFile(suDoc, payload, s3);

    // Fire a verification email (matches original shape)
    const from = 'noreply@email.1var.com';
    const to   = 'austin@1var.com';
    const subject  = '1 VAR - Email Address Verification Request';
    const verifyURL = `http://1var.com/verify/${suRoot}`;
    const text  = `Dear 1 Var User,\n\nWe have received a request to create a new group at 1 VAR. If you requested this, please visit:\n\n${verifyURL}`;
    const html  = `Dear 1 Var User,<br><br>We have received a request to create a new group at 1 VAR. If you requested this, please visit:<br><br>${verifyURL}`;
    await email(from, to, subject, text, html, ctx.deps.ses);

    // Return the new document view
    const mainObj = await convertToJSON(
      suDoc, [], null, null, cookie, dynamodb, uuidv4,
      null, [], {}, '', dynamodbLL, ctx.req.body
    );

    return { ok: true, response: mainObj };
  });

  on('useGroup', async (ctx, { cookie }) => {
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;

    const getSub       = use('getSub');
    const getEntity    = use('getEntity');
    const addVersion   = use('addVersion');
    const updateEntity = use('updateEntity');
    const convertToJSON= use('convertToJSON');

    const parts = ctx.path.split('/');
    const newUsingSU = parts[3];   // entity to mark as "using"
    const headSU     = parts[4];   // head of the used group

    const usingSub = await getSub(newUsingSU, 'su', dynamodb);
    const usedSub  = await getSub(headSU, 'su', dynamodb);
    const ug = await getEntity(usingSub.Items[0].e, dynamodb);
    const ud = await getEntity(usedSub.Items[0].e, dynamodb);

    const v = await addVersion(ug.Items[0].e.toString(), 'u', ud.Items[0].e.toString(), ug.Items[0].c, dynamodb);
    await updateEntity(ug.Items[0].e.toString(), 'u', ud.Items[0].e.toString(), v.v, v.c, dynamodb);

    const headOfUsing = await getSub(ug.Items[0].h, 'e', dynamodb);
    const mainObj = await convertToJSON(
      headOfUsing.Items[0].su, [], null, null,
      cookie, dynamodb, uuidv4,
      null, [], {}, '', dynamodbLL, ctx.req.body
    );

    return { ok: true, response: mainObj };
  });

  on('substituteGroup', async (ctx, { cookie }) => {
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;

    const getSub       = use('getSub');
    const getEntity    = use('getEntity');
    const addVersion   = use('addVersion');
    const updateEntity = use('updateEntity');
    const convertToJSON= use('convertToJSON');

    const parts = ctx.path.split('/');
    const newSubstitutingSU = parts[3];
    const headSubstitutingSU = parts[4];

    const sg = await getSub(newSubstitutingSU, 'su', dynamodb);
    const sd = await getSub(headSubstitutingSU, 'su', dynamodb);
    const sge = await getEntity(sg.Items[0].e, dynamodb);
    const sde = await getEntity(sd.Items[0].e, dynamodb);

    const v = await addVersion(sge.Items[0].e.toString(), 'z', sde.Items[0].e.toString(), sge.Items[0].c, dynamodb);
    await updateEntity(sge.Items[0].e.toString(), 'z', sde.Items[0].e.toString(), v.v, v.c, dynamodb);

    const headOfSub = await getSub(sge.Items[0].h, 'e', dynamodb);
    const mainObj = await convertToJSON(
      headOfSub.Items[0].su, [], null, null,
      cookie, dynamodb, uuidv4,
      null, [], {}, '', dynamodbLL, ctx.req.body
    );

    return { ok: true, response: mainObj };
  });
};
